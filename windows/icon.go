package main

import (
	"bytes"
	"encoding/binary"
	"image"
	"image/color"
	"image/png"
	"runtime"
)

const iconSize = 32
const ss = 4 // 슈퍼샘플 배율 → 다운스케일로 안티에일리어싱

// 둥근 사각형 내부 판정 (최종 px 좌표, 픽셀 중심 +0.5)
func inRR(px, py, x, y, w, h, r float64) bool {
	if px < x || py < y || px >= x+w || py >= y+h {
		return false
	}
	rx, ry := r, r
	if rx > w/2 {
		rx = w / 2
	}
	if ry > h/2 {
		ry = h / 2
	}
	left, right := px < x+rx, px >= x+w-rx
	top, bot := py < y+ry, py >= y+h-ry
	if (left || right) && (top || bot) {
		cx := x + rx
		if right {
			cx = x + w - rx
		}
		cy := y + ry
		if bot {
			cy = y + h - ry
		}
		dx := (px + 0.5 - cx) / rx
		dy := (py + 0.5 - cy) / ry
		return dx*dx+dy*dy <= 1
	}
	return true
}

// 배터리 아이콘을 iconSize×iconSize RGBA로 렌더. remain<0 이면 빈 배터리.
func drawBattery(remain int, dark bool) *image.RGBA {
	W := iconSize * ss
	big := image.NewRGBA(image.Rect(0, 0, W, W))
	ink := color.RGBA{40, 40, 40, 255}
	if dark {
		ink = color.RGBA{235, 235, 235, 255}
	}
	// 최종 px 기하 (가로 배터리, 32칸 중앙)
	bx, by, bw, bh := 3.0, 9.0, 24.0, 14.0
	rr, stroke := 3.0, 2.0
	tw, th := 3.0, 6.0
	innerX, innerY := bx+stroke, by+stroke
	innerW, innerH := bw-2*stroke, bh-2*stroke
	innerR := rr - stroke

	var fillCol color.RGBA
	fw := 0.0
	if remain >= 0 {
		v := remain
		if v > 100 {
			v = 100
		}
		fw = float64(v) / 100 * innerW
		c := heatColor(remain)
		fillCol = color.RGBA{c.R, c.G, c.B, 255}
	}

	for py := 0; py < W; py++ {
		for px := 0; px < W; px++ {
			fx, fy := float64(px)/ss, float64(py)/ss
			// 단자
			if inRR(fx, fy, bx+bw, by+(bh-th)/2, tw, th, 1) {
				big.SetRGBA(px, py, ink)
				continue
			}
			// 테두리 (외곽 - 내곽)
			if inRR(fx, fy, bx, by, bw, bh, rr) && !inRR(fx, fy, innerX, innerY, innerW, innerH, innerR) {
				big.SetRGBA(px, py, ink)
				continue
			}
			// 채움 (잔량 길이만큼)
			if fw > 0.5 && fx >= innerX && fx < innerX+fw && inRR(fx, fy, innerX, innerY, innerW, innerH, innerR) {
				big.SetRGBA(px, py, fillCol)
			}
		}
	}
	return downscale(big, iconSize)
}

// 박스 평균 다운스케일 (프리멀티플라이드 → 가장자리 AA)
func downscale(src *image.RGBA, size int) *image.RGBA {
	out := image.NewRGBA(image.Rect(0, 0, size, size))
	scale := src.Bounds().Dx() / size
	n := float64(scale * scale)
	for j := 0; j < size; j++ {
		for i := 0; i < size; i++ {
			var rs, gs, bs, as float64
			for sy := 0; sy < scale; sy++ {
				for sx := 0; sx < scale; sx++ {
					c := src.RGBAAt(i*scale+sx, j*scale+sy)
					a := float64(c.A)
					rs += float64(c.R) * a
					gs += float64(c.G) * a
					bs += float64(c.B) * a
					as += a
				}
			}
			var oc color.RGBA
			if as > 0 {
				oc = color.RGBA{uint8(rs / as), uint8(gs / as), uint8(bs / as), uint8(as / n)}
			}
			out.SetRGBA(i, j, oc)
		}
	}
	return out
}

// 트레이용 아이콘 바이트: Windows=ICO, 그 외=PNG
func iconBytes(img *image.RGBA) []byte {
	if runtime.GOOS == "windows" {
		return encodeICO(img)
	}
	var b bytes.Buffer
	png.Encode(&b, img)
	return b.Bytes()
}

// ICO = ICONDIR + ICONDIRENTRY + PNG (Vista+가 PNG-in-ICO 지원)
func encodeICO(img *image.RGBA) []byte {
	var pngBuf bytes.Buffer
	png.Encode(&pngBuf, img)
	pb := pngBuf.Bytes()
	var buf bytes.Buffer
	binary.Write(&buf, binary.LittleEndian, uint16(0)) // reserved
	binary.Write(&buf, binary.LittleEndian, uint16(1)) // type=icon
	binary.Write(&buf, binary.LittleEndian, uint16(1)) // count
	w, h := img.Bounds().Dx(), img.Bounds().Dy()
	bw, bh := byte(w), byte(h)
	if w >= 256 {
		bw = 0
	}
	if h >= 256 {
		bh = 0
	}
	buf.WriteByte(bw)
	buf.WriteByte(bh)
	buf.WriteByte(0) // color count
	buf.WriteByte(0) // reserved
	binary.Write(&buf, binary.LittleEndian, uint16(1))            // planes
	binary.Write(&buf, binary.LittleEndian, uint16(32))           // bitcount
	binary.Write(&buf, binary.LittleEndian, uint32(len(pb)))      // bytes in res
	binary.Write(&buf, binary.LittleEndian, uint32(6+16))         // offset
	buf.Write(pb)
	return buf.Bytes()
}
