// Command pbschema-poc is a proof of concept for a pure Go site build.
// It parses a FileDescriptorSet, writes model.json, and copies the compiled
// TypeScript page. It does not run Node.
package main

import (
	"flag"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"strings"

	"github.com/ymmt2005/pbschema-lens/poc/internal/compile"
	"github.com/ymmt2005/pbschema-lens/poc/internal/model"
	"github.com/ymmt2005/pbschema-lens/poc/internal/site"
)

func main() {
	if len(os.Args) < 2 {
		usage()
		os.Exit(2)
	}
	var err error
	switch os.Args[1] {
	case "build":
		err = runBuild(os.Args[2:])
	case "serve":
		err = runServe(os.Args[2:])
	case "help", "-h", "--help":
		usage()
		return
	default:
		usage()
		os.Exit(2)
	}
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}

func usage() {
	fmt.Fprintf(os.Stderr, `pbschema-poc is a proof of concept. The product CLI is still the Node pbschema-lens command.

Usage:
  pbschema-poc build [--out dir] [--base /] [--title text] [input]
  pbschema-poc serve [--dir dir] [--port 43147]

input is a Buf module directory (buf on PATH) or a FileDescriptorSet
(.binpb, .pb, .desc, .fds).
`)
}

func runBuild(args []string) error {
	input, out, base, title, err := parseBuildArgs(args)
	if err != nil {
		return err
	}
	absInput, err := filepath.Abs(input)
	if err != nil {
		return err
	}
	raw, err := compile.Load(absInput)
	if err != nil {
		return err
	}
	doc, err := model.Build(raw, title)
	if err != nil {
		return err
	}
	absOut, err := filepath.Abs(out)
	if err != nil {
		return err
	}
	if err := site.Write(absOut, doc, base); err != nil {
		return err
	}
	fmt.Printf("Wrote %d messages, %d enums, %d services to %s\n", len(doc.Messages), len(doc.Enums), len(doc.Services), absOut)
	return nil
}

// parseBuildArgs accepts flags before or after the input path.
func parseBuildArgs(args []string) (input, out, base, title string, err error) {
	out, base, title = "dist", "/", "Protobuf API"
	var positionals []string
	for i := 0; i < len(args); i++ {
		arg := args[i]
		key := arg
		val := ""
		hasValue := false
		if strings.HasPrefix(arg, "--") {
			if eq := strings.IndexByte(arg, '='); eq >= 0 {
				key, val, hasValue = arg[:eq], arg[eq+1:], true
			}
		}
		switch key {
		case "--out", "-o", "--base", "--title":
			if !hasValue {
				i++
				if i >= len(args) {
					return "", "", "", "", fmt.Errorf("%s needs a value", key)
				}
				val = args[i]
			}
			switch key {
			case "--out", "-o":
				out = val
			case "--base":
				base = val
			case "--title":
				title = val
			}
		case "--":
			positionals = append(positionals, args[i+1:]...)
			return finishBuildArgs(positionals, out, base, title)
		default:
			if strings.HasPrefix(arg, "-") {
				return "", "", "", "", fmt.Errorf("unknown flag %s", arg)
			}
			positionals = append(positionals, arg)
		}
	}
	return finishBuildArgs(positionals, out, base, title)
}

func finishBuildArgs(positionals []string, out, base, title string) (string, string, string, string, error) {
	if len(positionals) > 1 {
		return "", "", "", "", fmt.Errorf("build accepts one input")
	}
	input := "."
	if len(positionals) == 1 {
		input = positionals[0]
	}
	return input, out, base, title, nil
}

func runServe(args []string) error {
	flags := flag.NewFlagSet("serve", flag.ContinueOnError)
	dir := flags.String("dir", "dist", "Directory written by build")
	port := flags.Int("port", 43147, "Preview port")
	flags.SetOutput(os.Stderr)
	if err := flags.Parse(args); err != nil {
		return err
	}
	root, err := filepath.Abs(*dir)
	if err != nil {
		return err
	}
	server := &http.Server{
		Addr: fmt.Sprintf("127.0.0.1:%d", *port),
		Handler: http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			full, err := site.SafePath(root, r.URL.Path)
			if err != nil {
				http.Error(w, "forbidden", http.StatusForbidden)
				return
			}
			http.ServeFile(w, r, full)
		}),
	}
	fmt.Printf("Preview: http://127.0.0.1:%d/\n", *port)
	return server.ListenAndServe()
}
