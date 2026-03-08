#!/bin/bash
# Save screenshot to ~/Downloads
FILENAME="${1:-screenshot-$(date +%Y%m%d-%H%M%S).png}"
mkdir -p ~/Downloads/x-lens-screenshots
cp /dev/stdin ~/Downloads/x-lens-screenshots/"$FILENAME"
echo "Saved to ~/Downloads/x-lens-screenshots/$FILENAME"
