package site

import "embed"

// Dist is the compiled browser UI. npm run build:ui refreshes it before go build.
//
//go:embed all:dist
var Dist embed.FS
