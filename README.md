

# WardriveVisualizer V2 <a href="https://wigle.net">
<img border="0" src="https://wigle.net/bi/jLMtqK6AajNmjLCFhXoCcw.png">
</a> 


A dark-themed, map-based wardriving visualization app built with **Next.js** and **Leaflet**.

WardriveVisualizer V2 parses WiGLE-format CSV exports and renders your collected network data as density-colored trails on an interactive map — with live GPS tracking and statistics overlay.

---

## 🚀 Features

### 📡 CSV Parsing API (`/api/wardriving`)

* Fetches WiGLE-compatible CSV
* Parses WiFi / BLE / GSM entries
* Deduplicates nearby coordinates (~11m grid)
* Calculates visit density per location
* Aggregates unique SSIDs & device stats

### 🗺 Interactive Map

* Built with Leaflet
* Dark tile layer (CartoDB Dark Matter)
* Density-based coloring:

  * 🔵 Low density
  * 🟡 Medium density
  * 🔴 High density
* Road-following polyline rendering

### 📊 Floating UI

* Live statistics panel
* Total points
* WiFi / BLE / GSM breakdown
* Unique SSIDs counter
* Fit-to-bounds button
* Center-on-user button
* Toggle GPS tracking

### 📍 Live GPS Tracking

* Real-time location updates
* Cyan pulsing marker
* Accuracy radius circle
* Works on mobile & desktop

---

## 🧱 Tech Stack

* Framework: Next.js
* Map Engine: Leaflet
* Tile Layer: CartoDB Dark Matter
* Styling: Custom dark theme
* Data Format: WiGLE CSV

---

## 📂 Project Structure

```
app/
  api/wardriving/route.ts
  page.tsx

components/
  Map.tsx

styles/
  globals.css
```

---

## 🛠 Installation

```bash
git clone https://github.com/DXXNS/Wardriving-Webpage.git
cd Wardriving-Webpage
npm install
npm run dev
```

Runs on:

```
http://localhost:3000
```

---

## 📄 Expected CSV Format

WiGLE export including:

* Latitude
* Longitude
* SSID
* Network Type (WIFI / BLE / GSM)

The backend automatically:

* Parses rows
* Removes near-duplicate points
* Groups by density
* Returns optimized JSON for rendering

---

## 🎯 Design Goals

* Dark-first UI
* Clean & minimal
* Fast rendering
* Scalable for large datasets
* Road-accurate visualization aesthetic

---

## 🔐 Privacy

This tool visualizes your own wardriving data.
No external storage or automatic uploads beyond the configured CSV source.

---

## 👤 Author

DXXNS 

