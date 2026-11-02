/* =========================================
   GPS SPEEDOMETER - ROUTE TRACKING
   GPS OTOMATIS + AUTO ZOOM
   ========================================= */

// PENGATURAN GPS
const MIN_ACCURACY = 50;
const MIN_MOVEMENT = 2;
const MAX_JUMP_DISTANCE = 100;
const MAX_SPEED = 180;

// DATA PERJALANAN
let watchId = null;
let timerInterval = null;

let map = null;
let motorMarker = null;
let routeLine = null;
let startMarker = null;
let endMarker = null;

let previousPosition = null;
let lastPosition = null;

let tracking = false;
let paused = false;

let currentSpeed = 0;
let maxSpeed = 0;
let totalDistance = 0;
let activeSeconds = 0;

let speedSamples = [];
let routeCoordinates = [];

// STATUS GPS
let hasCenteredOnUser = false;

// ELEMEN HTML
const speedElement = document.getElementById("speed");
const maxSpeedElement = document.getElementById("maxSpeed");
const avgSpeedElement = document.getElementById("avgSpeed");
const distanceElement = document.getElementById("distance");
const durationElement = document.getElementById("duration");
const coordinatesElement = document.getElementById("coordinates");
const accuracyElement = document.getElementById("accuracy");
const gpsStatusElement = document.getElementById("gpsStatus");

const startBtn = document.getElementById("startBtn");
const pauseBtn = document.getElementById("pauseBtn");
const stopBtn = document.getElementById("stopBtn");

// =========================================
// FORMAT DATA
// =========================================

function formatTime(seconds) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);

  return [
    String(h).padStart(2, "0"),
    String(m).padStart(2, "0"),
    String(s).padStart(2, "0")
  ].join(":");
}

function updateDashboard() {
  if (speedElement) {
    speedElement.textContent = Math.round(currentSpeed);
  }

  if (maxSpeedElement) {
    maxSpeedElement.textContent = maxSpeed.toFixed(1) + " km/h";
  }

  if (distanceElement) {
    distanceElement.textContent = totalDistance.toFixed(2) + " km";
  }

  if (durationElement) {
    durationElement.textContent = formatTime(activeSeconds);
  }

  const average = activeSeconds > 0
    ? totalDistance / (activeSeconds / 3600)
    : 0;

  if (avgSpeedElement) {
    avgSpeedElement.textContent = average.toFixed(1) + " km/h";
  }
}

// =========================================
// HITUNG JARAK GPS
// =========================================

function calculateDistance(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const rad = value => value * Math.PI / 180;

  const dLat = rad(lat2 - lat1);
  const dLon = rad(lon2 - lon1);

  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(lat1)) *
    Math.cos(rad(lat2)) *
    Math.sin(dLon / 2) ** 2;

  return R * 2 * Math.atan2(
    Math.sqrt(a),
    Math.sqrt(1 - a)
  );
}

// =========================================
// IKON PETA
// =========================================

function createMapIcon(emoji) {
  return L.divIcon({
    className: "motor-marker",
    html: emoji,
    iconSize: [42, 42],
    iconAnchor: [21, 21]
  });
}

// =========================================
// INISIALISASI PETA
// =========================================

function initializeMap() {
  const mapElement = document.getElementById("map");

  if (!mapElement) {
    console.error("Elemen map tidak ditemukan.");
    return;
  }

  if (typeof L === "undefined") {
    console.error("Leaflet belum dimuat.");

    if (gpsStatusElement) {
      gpsStatusElement.textContent = "Leaflet tidak tersedia";
    }

    return;
  }

  if (map) return;

  map = L.map("map").setView([-2.5, 118], 5);

  const mapSources = [
    {
      name: "OpenStreetMap HOT",
      url: "https://{s}.tile.openstreetmap.fr/hot/{z}/{x}/{y}.png",
      options: {
        subdomains: "abc",
        maxZoom: 19,
        attribution: "&copy; OpenStreetMap contributors"
      }
    },
    {
      name: "OpenStreetMap",
      url: "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
      options: {
        maxZoom: 19,
        attribution: "&copy; OpenStreetMap contributors"
      }
    },
    {
      name: "CARTO",
      url: "https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png",
      options: {
        subdomains: "abcd",
        maxZoom: 19,
        attribution: "&copy; OpenStreetMap &copy; CARTO"
      }
    }
  ];

  let sourceIndex = 0;
  let currentLayer = null;
  let switching = false;

  function loadMapSource(index) {
    if (index >= mapSources.length) {
      console.error("Semua sumber peta gagal dimuat.");

      if (gpsStatusElement) {
        gpsStatusElement.textContent = "Server peta tidak tersedia";
      }

      return;
    }

    sourceIndex = index;
    switching = false;

    const source = mapSources[index];

    if (currentLayer) {
      map.removeLayer(currentLayer);
    }

    currentLayer = L.tileLayer(source.url, source.options);

    let loadedTiles = false;

    currentLayer.on("tileload", function () {
      loadedTiles = true;
    });

    currentLayer.on("tileerror", function () {
      if (!loadedTiles && !switching) {
        switching = true;

        console.warn(
          "Mencoba sumber peta berikutnya:",
          source.name
        );

        setTimeout(function () {
          loadMapSource(sourceIndex + 1);
        }, 1500);
      }
    });

    currentLayer.addTo(map);
  }

  loadMapSource(0);

  // IKON MOTOR
  motorMarker = L.marker([-2.5, 118], {
    icon: createMapIcon("🏍️")
  });

  // GARIS RUTE BIRU
  routeLine = L.polyline([], {
    color: "#168cff",
    weight: 5,
    opacity: 0.9,
    lineCap: "round",
    lineJoin: "round"
  }).addTo(map);

  setTimeout(function () {
    map.invalidateSize();

    // Jika GPS sudah ditemukan sebelum peta siap
    if (lastPosition && !hasCenteredOnUser) {
      updateMapPosition(lastPosition[0], lastPosition[1]);
    }
  }, 1000);
}

// =========================================
// RESET PERJALANAN
// =========================================

function resetTrip() {
  currentSpeed = 0;
  maxSpeed = 0;
  totalDistance = 0;
  activeSeconds = 0;

  previousPosition = null;

  speedSamples = [];
  routeCoordinates = [];

  if (routeLine) {
    routeLine.setLatLngs([]);
  }

  if (startMarker && map) {
    map.removeLayer(startMarker);
    startMarker = null;
  }

  if (endMarker && map) {
    map.removeLayer(endMarker);
    endMarker = null;
  }

  updateDashboard();
}

// =========================================
// UPDATE POSISI MOTOR
// =========================================

function updateMapPosition(lat, lon) {
  if (!map || !motorMarker) return;

  const position = [lat, lon];

  motorMarker.setLatLng(position);

  if (!map.hasLayer(motorMarker)) {
    motorMarker.addTo(map);
  }

  // AUTO ZOOM PADA LOKASI GPS PERTAMA
  if (!hasCenteredOnUser) {
    map.flyTo(position, 17, {
      animate: true,
      duration: 1.5
    });

    hasCenteredOnUser = true;
  }
}

// =========================================
// TAMBAHKAN TITIK RUTE
// =========================================

function addRoutePoint(lat, lon) {
  if (!map || !routeLine) return;

  const point = [lat, lon];

  routeCoordinates.push(point);

  routeLine.setLatLngs(routeCoordinates);

  // TITIK MULAI
  if (!startMarker) {
    startMarker = L.marker(point, {
      icon: createMapIcon("🟢")
    }).addTo(map);

    startMarker.bindPopup("Titik Mulai");
  }
}

// =========================================
// GPS BERHASIL
// =========================================

function onGPSSuccess(position) {
  const coords = position.coords;

  const lat = coords.latitude;
  const lon = coords.longitude;
  const accuracy = coords.accuracy;

  // TAMPILKAN KOORDINAT
  if (accuracyElement) {
    accuracyElement.textContent =
      "Akurasi: " + Math.round(accuracy) + " m";
  }

  if (coordinatesElement) {
    coordinatesElement.textContent =
      lat.toFixed(6) + ", " + lon.toFixed(6);
  }

  lastPosition = [lat, lon];

  // UPDATE MARKER DAN AUTO ZOOM
  updateMapPosition(lat, lon);

  // GPS BELUM AKURAT
  if (accuracy > 100) {
    if (gpsStatusElement && !paused) {
      gpsStatusElement.textContent = "Mencari sinyal GPS...";
    }

    return;
  }

  // LOKASI DITEMUKAN, PERJALANAN BELUM DIMULAI
  if (!tracking) {
    if (gpsStatusElement) {
      gpsStatusElement.textContent = "Lokasi ditemukan";
    }

    return;
  }

  // GPS TETAP AKTIF SAAT JEDA
  if (paused) {
    return;
  }

  if (gpsStatusElement) {
    gpsStatusElement.textContent = "GPS Aktif";
  }

  if (accuracy > MIN_ACCURACY) return;

  // TITIK GPS PERTAMA
  if (!previousPosition) {
    previousPosition = {
      lat: lat,
      lon: lon,
      timestamp: position.timestamp
    };

    addRoutePoint(lat, lon);

    currentSpeed = 0;
    updateDashboard();

    return;
  }

  const distance = calculateDistance(
    previousPosition.lat,
    previousPosition.lon,
    lat,
    lon
  );

  const elapsed =
    (position.timestamp - previousPosition.timestamp) / 1000;

  if (elapsed <= 0) return;

  // CEGAH LOMPATAN GPS
  if (distance > MAX_JUMP_DISTANCE) {
    previousPosition = {
      lat: lat,
      lon: lon,
      timestamp: position.timestamp
    };

    currentSpeed = 0;
    updateDashboard();

    return;
  }

  const calculatedSpeed = (distance / elapsed) * 3.6;

  if (calculatedSpeed > MAX_SPEED) {
    previousPosition = {
      lat: lat,
      lon: lon,
      timestamp: position.timestamp
    };

    currentSpeed = 0;
    updateDashboard();

    return;
  }

  // ADA PERGERAKAN
  if (distance >= MIN_MOVEMENT) {
    totalDistance += distance / 1000;

    let gpsSpeed =
      coords.speed !== null &&
      coords.speed !== undefined
        ? coords.speed * 3.6
        : calculatedSpeed;

    if (
      !Number.isFinite(gpsSpeed) ||
      gpsSpeed < 0 ||
      gpsSpeed > MAX_SPEED
    ) {
      gpsSpeed = calculatedSpeed;
    }

    speedSamples.push(gpsSpeed);

    if (speedSamples.length > 5) {
      speedSamples.shift();
    }

    currentSpeed =
      speedSamples.reduce((a, b) => a + b, 0) /
      speedSamples.length;

    if (currentSpeed < 3) {
      currentSpeed = 0;
    }

    maxSpeed = Math.max(maxSpeed, currentSpeed);

    // GAMBAR GARIS RUTE
    addRoutePoint(lat, lon);
  } else {
    currentSpeed = 0;
  }

  previousPosition = {
    lat: lat,
    lon: lon,
    timestamp: position.timestamp
  };

  updateDashboard();
}

// =========================================
// GPS ERROR
// =========================================

function onGPSError(error) {
  let message = "GPS tidak tersedia";

  if (error.code === 1) {
    message = "Izin lokasi ditolak";
  } else if (error.code === 2) {
    message = "Sinyal GPS tidak ditemukan";
  } else if (error.code === 3) {
    message = "GPS timeout";
  }

  if (gpsStatusElement) {
    gpsStatusElement.textContent = message;
  }

  console.error("GPS Error:", error.message);
}

// =========================================
// GPS OTOMATIS SAAT APLIKASI DIBUKA
// =========================================

function startLocationWatch() {
  if (!navigator.geolocation) {
    if (gpsStatusElement) {
      gpsStatusElement.textContent =
        "Browser tidak mendukung GPS";
    }

    return;
  }

  // CEGAH GPS WATCHER GANDA
  if (watchId !== null) return;

  if (gpsStatusElement) {
    gpsStatusElement.textContent = "Mencari lokasi GPS...";
  }

  watchId = navigator.geolocation.watchPosition(
    onGPSSuccess,
    onGPSError,
    {
      enableHighAccuracy: true,
      maximumAge: 1000,
      timeout: 20000
    }
  );
}

// =========================================
// TIMER
// =========================================

function startTimer() {
  if (timerInterval) {
    clearInterval(timerInterval);
  }

  timerInterval = setInterval(function () {
    if (tracking && !paused) {
      activeSeconds++;
      updateDashboard();
    }
  }, 1000);
}

// =========================================
// MULAI / LANJUTKAN
// =========================================

function startTracking() {
  if (!navigator.geolocation) {
    alert("Browser tidak mendukung GPS.");
    return;
  }

  if (tracking && !paused) return;

  if (!tracking) {
    resetTrip();
  }

  tracking = true;
  paused = false;

  previousPosition = null;

  if (gpsStatusElement) {
    gpsStatusElement.textContent = "Memulai perjalanan...";
  }

  if (startBtn) {
    startBtn.disabled = true;
    startBtn.textContent = "Mulai";
  }

  if (pauseBtn) pauseBtn.disabled = false;
  if (stopBtn) stopBtn.disabled = false;

  if (!timerInterval) {
    startTimer();
  }

  // GPS SUDAH AKTIF, TIDAK MEMBUAT WATCHER BARU
  startLocationWatch();
}

// =========================================
// JEDA
// =========================================

function pauseTracking() {
  if (!tracking || paused) return;

  paused = true;

  currentSpeed = 0;

  if (gpsStatusElement) {
    gpsStatusElement.textContent = "Perjalanan dijeda";
  }

  if (startBtn) {
    startBtn.disabled = false;
    startBtn.textContent = "Lanjutkan";
  }

  if (pauseBtn) pauseBtn.disabled = true;

  updateDashboard();
}

// =========================================
// STOP
// =========================================

function stopTracking() {
  if (!tracking) return;

  if (timerInterval) {
    clearInterval(timerInterval);
    timerInterval = null;
  }

  // SIMPAN PERJALANAN KE RIWAYAT
  if (typeof saveTripToHistory === "function") {
    saveTripToHistory();
  }

  // PENANDA TITIK AKHIR
  if (map && lastPosition) {
    if (endMarker) {
      map.removeLayer(endMarker);
    }

    endMarker = L.marker(lastPosition, {
      icon: createMapIcon("🔴")
    }).addTo(map);

    endMarker.bindPopup("Titik Selesai");
  }

  tracking = false;
  paused = false;

  currentSpeed = 0;
  previousPosition = null;
  speedSamples = [];

  if (gpsStatusElement) {
    gpsStatusElement.textContent = "Perjalanan selesai";
  }

  if (startBtn) {
    startBtn.disabled = false;
    startBtn.textContent = "Mulai";
  }

  if (pauseBtn) pauseBtn.disabled = true;
  if (stopBtn) stopBtn.disabled = true;

  updateDashboard();
}

// =========================================
// HUBUNGKAN TOMBOL
// =========================================

if (startBtn) {
  startBtn.addEventListener("click", startTracking);
}

if (pauseBtn) {
  pauseBtn.addEventListener("click", pauseTracking);
}

if (stopBtn) {
  stopBtn.addEventListener("click", stopTracking);
}

// =========================================
// JALANKAN APLIKASI
// =========================================

initializeMap();
updateDashboard();

if (pauseBtn) pauseBtn.disabled = true;
if (stopBtn) stopBtn.disabled = true;

// LANGSUNG AKTIFKAN GPS SAAT APLIKASI DIBUKA
startLocationWatch();

console.log("GPS Speedometer Route Tracking siap.");