package main

import (
	"encoding/json"
	"fmt"
	"image"
	"image/color"
	"image/draw"
	"image/png"
	"os"
)

// 헤드리스 검증: 배터리 아이콘 미리보기 PNG + gather() 스냅샷 출력 (GUI 불필요)
func dump() {
	remains := []int{95, 70, 50, 30, 10, -1}
	pad, cell := 6, iconSize
	W := (cell+pad)*len(remains) + pad
	H := cell + pad*2
	canvas := image.NewRGBA(image.Rect(0, 0, W, H))
	draw.Draw(canvas, canvas.Bounds(), &image.Uniform{color.RGBA{30, 30, 30, 255}}, image.Point{}, draw.Src)
	x := pad
	for _, r := range remains {
		ic := drawBattery(r, true)
		draw.Draw(canvas, image.Rect(x, pad, x+cell, pad+cell), ic, image.Point{}, draw.Over)
		x += cell + pad
	}
	// 8배 확대 (nearest) — 눈으로 보기 좋게
	Z := 8
	big := image.NewRGBA(image.Rect(0, 0, W*Z, H*Z))
	for y := 0; y < H*Z; y++ {
		for xx := 0; xx < W*Z; xx++ {
			big.Set(xx, y, canvas.At(xx/Z, y/Z))
		}
	}
	out := os.Getenv("DUMP_PNG")
	if out == "" {
		out = "/tmp/ccb-tray-preview.png"
	}
	if f, err := os.Create(out); err == nil {
		png.Encode(f, big)
		f.Close()
		fmt.Fprintln(os.Stderr, "wrote", out)
	}

	b, _ := json.MarshalIndent(gather(), "", "  ")
	fmt.Println(string(b))
}
