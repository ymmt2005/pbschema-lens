package main

import (
	"errors"
	"flag"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/ymmt2005/pbschema-lens/internal/fds"
	"github.com/ymmt2005/pbschema-lens/internal/model"
	"github.com/ymmt2005/pbschema-lens/internal/pipeline"
	"github.com/ymmt2005/pbschema-lens/internal/site"
)

var version = "0.5.0"

func main() {
	if err := run(os.Args[1:]); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}

func run(args []string) error {
	if len(args) == 0 || args[0] == "-h" || args[0] == "--help" {
		fmt.Print(usage)
		return nil
	}
	switch args[0] {
	case "build":
		return ignoreHelp(cmdBuild(args[1:]))
	case "dev":
		return ignoreHelp(cmdDev(args[1:]))
	case "doctor":
		return ignoreHelp(cmdDoctor(args[1:]))
	case "diff":
		return ignoreHelp(cmdDiff(args[1:]))
	case "init":
		return ignoreHelp(cmdInit(args[1:]))
	case "version", "--version", "-v":
		fmt.Println(version)
		return nil
	default:
		return fmt.Errorf("unknown command %q\n%s", args[0], usage)
	}
}

func ignoreHelp(err error) error {
	if errors.Is(err, errHelp) {
		return nil
	}
	return err
}

const usage = `pbschema-lens generates a static Protocol Buffers schema site from a FileDescriptorSet.

pbschema-lens does not compile Protocol Buffers. Pipe a FileDescriptorSet from Buf:

  buf build -o - --as-file-descriptor-set | pbschema-lens build --out dist

Usage:
  pbschema-lens build [descriptor] [flags]
  pbschema-lens dev [descriptor] [flags]
  pbschema-lens doctor [descriptor]
  pbschema-lens diff [descriptor] --against descriptor
  pbschema-lens init [--github-pages]

Run pbschema-lens <command> --help for that command's flags.
descriptor is a FileDescriptorSet file (.binpb, .pb, .desc) or - for stdin.
`

var errHelp = errors.New("help")

type flags struct {
	out     string
	base    string
	title   string
	config  string
	source  string
	against string
	commit  string
	port    string
	pages   bool
	rest    []string
}

func parseSet(fs *flag.FlagSet, args []string, name string, boolFlags ...string) error {
	fs.Usage = func() {}
	err := fs.Parse(allowFlagsAfterArgs(args, boolFlags))
	if err == flag.ErrHelp {
		fmt.Print(helpText(name))
		return errHelp
	}
	return err
}

// allowFlagsAfterArgs lets a descriptor path come before flags.
// The standard flag package stops at the first non-flag.
func allowFlagsAfterArgs(args []string, boolFlags []string) []string {
	bools := map[string]bool{"h": true, "help": true}
	for _, name := range boolFlags {
		bools[name] = true
	}
	var flags, rest []string
	for i := 0; i < len(args); i++ {
		arg := args[i]
		if arg == "--" {
			rest = append(rest, args[i+1:]...)
			break
		}
		if arg == "-" || !strings.HasPrefix(arg, "-") {
			rest = append(rest, arg)
			continue
		}
		flags = append(flags, arg)
		body := strings.TrimLeft(arg, "-")
		if body == "" || strings.Contains(body, "=") || bools[body] {
			continue
		}
		if i+1 < len(args) {
			i++
			flags = append(flags, args[i])
		}
	}
	return append(flags, rest...)
}

func bindSiteFlags(fs *flag.FlagSet, f *flags) {
	fs.StringVar(&f.out, "out", "", "output directory")
	fs.StringVar(&f.out, "o", "", "output directory")
	fs.StringVar(&f.base, "base", "", "URL path prefix")
	fs.StringVar(&f.title, "title", "", "site title")
	fs.StringVar(&f.config, "config", "", "config file")
	fs.StringVar(&f.config, "c", "", "config file")
	fs.StringVar(&f.source, "source", "", "directory of .proto files")
	fs.StringVar(&f.commit, "commit", "", "commit for repository links")
}

func parseBuild(name string, args []string) (flags, error) {
	fs := flag.NewFlagSet(name, flag.ContinueOnError)
	fs.SetOutput(io.Discard)
	var f flags
	bindSiteFlags(fs, &f)
	fs.StringVar(&f.against, "against", "", "FileDescriptorSet to compare")
	if err := parseSet(fs, args, name); err != nil {
		return f, err
	}
	if fs.NArg() > 1 {
		return f, fmt.Errorf("%s accepts at most one descriptor path", name)
	}
	f.rest = fs.Args()
	return f, nil
}

func parseDev(args []string) (flags, error) {
	fs := flag.NewFlagSet("dev", flag.ContinueOnError)
	fs.SetOutput(io.Discard)
	var f flags
	bindSiteFlags(fs, &f)
	fs.StringVar(&f.port, "port", "", "listen port")
	if err := parseSet(fs, args, "dev"); err != nil {
		return f, err
	}
	if fs.NArg() > 1 {
		return f, fmt.Errorf("dev accepts at most one descriptor path")
	}
	f.rest = fs.Args()
	return f, nil
}

func parseDoctor(args []string) (flags, error) {
	fs := flag.NewFlagSet("doctor", flag.ContinueOnError)
	fs.SetOutput(io.Discard)
	var f flags
	fs.StringVar(&f.config, "config", "", "config file")
	fs.StringVar(&f.config, "c", "", "config file")
	if err := parseSet(fs, args, "doctor"); err != nil {
		return f, err
	}
	if fs.NArg() > 1 {
		return f, fmt.Errorf("doctor accepts at most one descriptor path")
	}
	f.rest = fs.Args()
	return f, nil
}

func parseInit(args []string) (flags, error) {
	fs := flag.NewFlagSet("init", flag.ContinueOnError)
	fs.SetOutput(io.Discard)
	var f flags
	fs.BoolVar(&f.pages, "github-pages", false, "write a GitHub Pages workflow")
	if err := parseSet(fs, args, "init", "github-pages"); err != nil {
		return f, err
	}
	if fs.NArg() > 0 {
		return f, fmt.Errorf("init does not take positional arguments")
	}
	return f, nil
}

func helpText(name string) string {
	switch name {
	case "build":
		return `Usage: pbschema-lens build [descriptor] [flags]

Flags:
  -o, --out directory     output directory
      --base path         URL path prefix
      --title text        site title
  -c, --config file       config file
      --source directory  .proto files for the source browser
      --commit rev        commit for repository links
      --against file      FileDescriptorSet to compare

descriptor is a FileDescriptorSet file or - for stdin.
`
	case "dev":
		return `Usage: pbschema-lens dev [descriptor] [flags]

Watches the descriptor file and serves the site over HTTP. dev does not invoke Buf.

Flags:
  -o, --out directory     output directory
      --base path         URL path prefix
      --title text        site title
  -c, --config file       config file
      --source directory  .proto files for the source browser
      --commit rev        commit for repository links
      --port number       listen port (default 43147)
`
	case "doctor":
		return `Usage: pbschema-lens doctor [descriptor]

Flags:
  -c, --config file       config file
`
	case "diff":
		return `Usage: pbschema-lens diff [descriptor] --against file [flags]

Compares two FileDescriptorSets. This command does not run buf breaking.

Flags:
  -o, --out directory     output directory
      --base path         URL path prefix
      --title text        site title
  -c, --config file       config file
      --source directory  .proto files for the source browser
      --commit rev        commit for repository links
      --against file      FileDescriptorSet to compare (required)
`
	case "init":
		return `Usage: pbschema-lens init [--github-pages]

Writes pbschema-lens.yaml. --github-pages also writes .github/workflows/protobuf-docs.yml.
The workflow does not pass --source.
`
	default:
		return usage
	}
}

func cmdBuild(args []string) error {
	f, err := parseBuild("build", args)
	if err != nil {
		return err
	}
	req, err := request(f)
	if err != nil {
		return err
	}
	result, err := pipeline.Build(req)
	if err != nil {
		return err
	}
	fmt.Printf("Wrote %s (%d symbols)\n", result.OutDir, result.Model.BuildInfo.SymbolCount)
	return nil
}

func cmdDiff(args []string) error {
	f, err := parseBuild("diff", args)
	if err != nil {
		return err
	}
	if f.against == "" {
		return fmt.Errorf("diff requires --against, a FileDescriptorSet to compare")
	}
	req, err := request(f)
	if err != nil {
		return err
	}
	result, err := pipeline.Build(req)
	if err != nil {
		return err
	}
	fmt.Printf("Wrote %s (%d symbols)\n", result.OutDir, result.Model.BuildInfo.SymbolCount)
	return nil
}

func cmdDev(args []string) error {
	f, err := parseDev(args)
	if err != nil {
		return err
	}
	req, err := request(f)
	if err != nil {
		return err
	}
	req, _, err = pipeline.Prepare(req)
	if err != nil {
		return err
	}
	if req.Input == "" || req.Input == "-" {
		return fmt.Errorf("dev needs a descriptor file to watch, not stdin")
	}
	result, err := pipeline.Build(req)
	if err != nil {
		return err
	}
	req.Input = result.Input
	port := f.port
	if port == "" {
		port = "43147"
	}
	addr := "127.0.0.1:" + port
	go watch(req)
	base := result.Config.Base
	if base == "" {
		base = "/"
	}
	fmt.Printf("Serving %s at http://%s%s\n", result.OutDir, addr, strings.TrimSuffix(base, "/")+"/")
	return http.ListenAndServe(addr, site.Handler(result.OutDir, base))
}

func watch(req pipeline.Request) {
	var last time.Time
	if st, err := os.Stat(req.Input); err == nil {
		last = st.ModTime()
	}
	for {
		time.Sleep(400 * time.Millisecond)
		st, err := os.Stat(req.Input)
		if err != nil || !st.ModTime().After(last) {
			continue
		}
		last = st.ModTime()
		if _, err := pipeline.Build(req); err != nil {
			fmt.Fprintln(os.Stderr, err)
		} else {
			fmt.Println("Rebuilt", req.Input)
		}
	}
}

func cmdDoctor(args []string) error {
	f, err := parseDoctor(args)
	if err != nil {
		return err
	}
	req, err := request(f)
	if err != nil {
		return err
	}
	req, cfg, err := pipeline.Prepare(req)
	if err != nil {
		fmt.Printf("error  config  %s\n", err)
		return err
	}
	fmt.Println("ok     config  loaded")
	raw, err := fds.Read(req.Input, req.Stdin)
	if err != nil {
		fmt.Printf("error  descriptor  %s\n", err)
		return err
	}
	files, err := fds.Files(raw)
	if err != nil {
		fmt.Printf("error  descriptor  %s\n", err)
		return err
	}
	schema, err := model.Build(files, model.BuildOptions{
		Title: cfg.Title, InputLabel: req.Input, Classification: cfg.Classification(),
	})
	if err != nil {
		fmt.Printf("error  model  %s\n", err)
		return err
	}
	fmt.Printf("ok     model  %d symbols from %d files\n", schema.BuildInfo.SymbolCount, schema.BuildInfo.FileCount)
	unknown := 0
	for _, symbol := range schema.Symbols {
		for _, option := range optionsOf(symbol) {
			if option.Value.Kind == "unknown" {
				unknown++
			}
		}
	}
	if unknown > 0 {
		fmt.Printf("warn   options  %d uninterpreted custom option value(s). Include the defining .proto files in the descriptor set.\n", unknown)
	} else {
		fmt.Println("ok     options  custom options resolved")
	}
	if cfg.Source != nil && (cfg.Source.Repository != "" || cfg.Source.URLTemplate != "") {
		fmt.Println("ok     source-links  source link configuration is present")
	} else {
		fmt.Println("warn   source-links  no source.repository configured. Pass --source to embed .proto text for View source.")
	}
	editions := 0
	for _, file := range schema.Files {
		if file.Syntax == "editions" {
			editions++
		}
	}
	if editions > 0 {
		fmt.Printf("ok     editions  %d file(s) use Protobuf Editions\n", editions)
	} else {
		fmt.Println("ok     editions  no Editions files in this schema")
	}
	return nil
}

func optionsOf(symbol any) []*model.DocOption {
	switch s := symbol.(type) {
	case *model.DocPackage:
		return s.Options
	case *model.DocFile:
		return s.Options
	case *model.DocMessage:
		return s.Options
	case *model.DocField:
		return s.Options
	case *model.DocOneof:
		return s.Options
	case *model.DocEnum:
		return s.Options
	case *model.DocEnumValue:
		return s.Options
	case *model.DocService:
		return s.Options
	case *model.DocMethod:
		return s.Options
	case *model.DocExtension:
		return s.Options
	default:
		return nil
	}
}

func cmdInit(args []string) error {
	f, err := parseInit(args)
	if err != nil {
		return err
	}
	cwd, err := os.Getwd()
	if err != nil {
		return err
	}
	configPath := filepath.Join(cwd, "pbschema-lens.yaml")
	if _, err := os.Stat(configPath); err == nil {
		return fmt.Errorf("%s already exists", configPath)
	}
	body := `title: "Protobuf API"
input: "-"
output: "dist"
base: "/"

source:
  # repository: "github:org/repo"
  # commit: "abc123"
  # urlTemplate: "https://src.example/{commit}/{file}#L{line}"

documentation:
  include: []
  exclude:
    - "third_party/**"

wellKnownTypes:
  enabled: true

search:
  fullText: true

sourceBrowser:
  enabled: true

artifacts:
  descriptorSet: false
`
	if err := os.WriteFile(configPath, []byte(body), 0o644); err != nil {
		return err
	}
	fmt.Println("wrote pbschema-lens.yaml")
	if f.pages {
		dir := filepath.Join(cwd, ".github", "workflows")
		if err := os.MkdirAll(dir, 0o755); err != nil {
			return err
		}
		workflow := pagesWorkflow
		path := filepath.Join(dir, "protobuf-docs.yml")
		if err := os.WriteFile(path, []byte(workflow), 0o644); err != nil {
			return err
		}
		fmt.Println("wrote .github/workflows/protobuf-docs.yml")
	}
	return nil
}

func request(f flags) (pipeline.Request, error) {
	cwd, err := os.Getwd()
	if err != nil {
		return pipeline.Request{}, err
	}
	input := ""
	if len(f.rest) > 0 {
		input = f.rest[0]
	}
	return pipeline.Request{
		CWD: cwd, ConfigFile: f.config, Input: input, Against: f.against,
		Out: f.out, Base: f.base, Title: f.title, SourceDir: f.source, Commit: f.commit, Stdin: os.Stdin,
	}, nil
}

const pagesWorkflow = `name: Protobuf Documentation

on:
  push:
    branches: [main]
    paths:
      - "**/*.proto"
      - "buf.yaml"
      - "buf.lock"
      - "pbschema-lens.yaml"
      - ".github/workflows/protobuf-docs.yml"

permissions:
  contents: read
  pages: write
  id-token: write

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: bufbuild/buf-setup-action@v1
      - name: Install pbschema-lens
        run: |
          curl -fsSL -o pbschema-lens.tar.gz \
            https://github.com/ymmt2005/pbschema-lens/releases/latest/download/pbschema-lens_linux_amd64.tar.gz
          tar -xzf pbschema-lens.tar.gz
          sudo mv pbschema-lens /usr/local/bin/pbschema-lens
      - name: Configure Pages
        id: pages
        uses: actions/configure-pages@v5
      - name: Build protobuf documentation
        env:
          PAGES_BASE_PATH: ${{ steps.pages.outputs.base_path }}
        run: |
          base="${PAGES_BASE_PATH:-/}"
          case "$base" in
            /) ;;
            */) ;;
            *) base="${base}/" ;;
          esac
          buf build -o - --as-file-descriptor-set | pbschema-lens build --out dist --base "$base" --commit "$GITHUB_SHA"
      - name: Upload Pages artifact
        uses: actions/upload-pages-artifact@v3
        with:
          path: dist

  deploy:
    needs: build
    runs-on: ubuntu-latest
    environment:
      name: github-pages
      url: ${{ steps.deployment.outputs.page_url }}
    steps:
      - name: Deploy
        id: deployment
        uses: actions/deploy-pages@v4
`
