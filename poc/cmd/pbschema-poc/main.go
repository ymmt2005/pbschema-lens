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
	flags := flag.NewFlagSet("build", flag.ContinueOnError)
	out := flags.String("out", "dist", "Output directory")
	base := flags.String("base", "/", "Site base path, for example /repo/")
	title := flags.String("title", "Protobuf API", "Site title")
	flags.SetOutput(os.Stderr)
	if err := flags.Parse(args); err != nil {
		return err
	}
	if flags.NArg() > 1 {
		return fmt.Errorf("build accepts one input")
	}
	input := "."
	if flags.NArg() == 1 {
		input = flags.Arg(0)
	}
	absInput, err := filepath.Abs(input)
	if err != nil {
		return err
	}
	raw, err := compile.Load(absInput)
	if err != nil {
		return err
	}
	doc, err := model.Build(raw, *title)
	if err != nil {
		return err
	}
	absOut, err := filepath.Abs(*out)
	if err != nil {
		return err
	}
	if err := site.Write(absOut, doc, *base); err != nil {
		return err
	}
	fmt.Printf("Wrote %d messages, %d enums, %d services to %s\n", len(doc.Messages), len(doc.Enums), len(doc.Services), absOut)
	return nil
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
