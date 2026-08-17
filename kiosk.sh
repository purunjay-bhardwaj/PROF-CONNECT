#!/usr/bin/env bash
URL="http://localhost:5000/kiosk/dr-ananya-sharma"
while true; do
  chromium-browser --noerrdialogs --disable-infobars --kiosk --incognito "$URL"
  sleep 5
done
