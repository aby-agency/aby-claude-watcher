#!/bin/bash
# Regenere build/background.png et build/background@2x.png a partir d'ImageMagick.
# Usage : ./build/generate-background.sh
#
# Pourquoi un script et pas un SVG : ImageMagick rend mal les fontes bold SVG
# (substitution en italique) et ignore stroke-dasharray. Rendu natif = WYSIWYG.

set -e
cd "$(dirname "$0")"

render() {
  local out="$1" w="$2" h="$3" s="$4"   # s = scale (1 ou 2)
  local box_x1=$((40 * s)) box_y1=$((290 * s)) box_x2=$((500 * s)) box_y2=$((480 * s))
  local arrow_y=$((200 * s))

  local args=(
    -size "${w}x${h}" canvas:'#f4f5f7'
    -fill '#fff7ed' -stroke '#fdba74' -strokewidth $((s == 2 ? 3 : 2))
    -draw "roundrectangle $box_x1,$box_y1 $box_x2,$box_y2 $((14*s)),$((14*s))"
    -stroke none -gravity North
    -font Arial-Gras -pointsize $((20*s)) -fill '#1f2937'
    -annotate "+0+$((30*s))" "1. Glissez l'app dans Applications"
    -font Arial-Gras -pointsize $((16*s)) -fill '#9a3412'
    -annotate "+0+$((305*s))" "2. Si macOS refuse l'ouverture"
    -font Arial -pointsize $((13*s)) -fill '#7c2d12'
    -annotate "+0+$((340*s))" "Double-cliquez sur le script ci-dessous (deverrouille puis lance l'app)."
    -font Arial -pointsize $((11*s)) -fill '#9a3412'
    -annotate "+0+$((365*s))" "Sans toucher au reste du Mac."
    -fill '#a78bfa' -stroke none
  )
  # Pointilles : 7 segments de 12px espaces de 8px, partant de x=200
  local seg_w=$((12*s)) gap=$((8*s)) start_x=$((200*s)) y_top=$((arrow_y - 2*s)) y_bot=$((arrow_y + 2*s))
  for i in 0 1 2 3 4 5 6; do
    local x1=$(( start_x + i * (seg_w + gap) ))
    local x2=$(( x1 + seg_w ))
    args+=(-draw "rectangle $x1,$y_top $x2,$y_bot")
  done
  # Triangle
  local tip_x=$((358*s)) base_x=$((338*s)) tip_top=$((190*s)) tip_bot=$((210*s))
  args+=(-draw "polygon $base_x,$tip_top $tip_x,$arrow_y $base_x,$tip_bot")
  args+=("$out")

  magick "${args[@]}"
}

render background.png 540 500 1
render background@2x.png 1080 1000 2
echo "Generated:"
ls -la background.png background@2x.png
