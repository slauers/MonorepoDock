package main

import (
	"embed"
	"log"

	"github.com/wailsapp/wails/v2"
	"github.com/wailsapp/wails/v2/pkg/options"
	"github.com/wailsapp/wails/v2/pkg/options/assetserver"
)

//go:embed all:frontend/dist
var assets embed.FS

func main() {
	app, err := NewApp()
	if err != nil {
		log.Fatalf("init app: %v", err)
	}

	if err := wails.Run(&options.App{
		Title:  "MonoDock",
		Width:  1360,
		Height: 860,
		AssetServer: &assetserver.Options{
			Assets: assets,
		},
		OnStartup: app.startup,
		OnShutdown: app.shutdown,
		Bind: []any{
			app,
		},
	}); err != nil {
		log.Fatalf("run app: %v", err)
	}
}
