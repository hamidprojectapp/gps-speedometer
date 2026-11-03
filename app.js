
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
let backgroundPollInterval = null;
let lastProcessedBackgroundIndex = 0;
let backgroundPolling = false;
let backgroundPlugin = null;

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

  if (accuracyElement) {
    accuracyElement.textContent =
      "Akurasi: " + Math.round(accuracy) + " m";
  }

  if (coordinatesElement) {
    coordinatesElement.textContent =
      lat.toFixed(6) + ", " + lon.toFixed(6);
  }

  lastPosition = [lat, lon];

  updateMapPosition(lat, lon);

  if (accuracy > 100) {
    if (gpsStatusElement && !paused) {
      gpsStatusElement.textContent = "Mencari sinyal GPS...";
    }

    return;
  }

  if (!tracking) {
    if (gpsStatusElement) {
      gpsStatusElement.textContent = "Lokasi ditemukan";
    }

    return;
  }

  if (paused) {
    return;
  }

  if (gpsStatusElement) {
    gpsStatusElement.textContent = "GPS Aktif";
  }

  if (accuracy > MIN_ACCURACY) return;

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
// DETEKSI LOKASI LEBIH CEPAT
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

  // AMBIL LOKASI TERAKHIR YANG TERSIMPAN
  navigator.geolocation.getCurrentPosition(
    function (position) {
      if (!tracking) {
        onGPSSuccess(position);
      }
    },
    function (error) {
      console.warn(
        "Lokasi awal belum tersedia:",
        error.message
      );
    },
    {
      enableHighAccuracy: false,
      maximumAge: 120000,
      timeout: 8000
    }
  );

  // AKTIFKAN GPS AKURASI TINGGI
  watchId = navigator.geolocation.watchPosition(
    onGPSSuccess,
    onGPSError,
    {
      enableHighAccuracy: true,
      maximumAge: 30000,
      timeout: 60000
    }
  );
}

// =========================================
// GPS BACKGROUND ANDROID
// =========================================

function getBackgroundPlugin() {
  return window.Capacitor?.Plugins?.BackgroundLocation || null;
}

async function pollBackgroundLocations() {
  if (backgroundPolling || !backgroundPlugin) return;

  backgroundPolling = true;

  try {
    const result = await backgroundPlugin.getLocations();
    const locations = result?.locations || [];

    while (lastProcessedBackgroundIndex < locations.length) {
      const point = locations[lastProcessedBackgroundIndex];

      lastProcessedBackgroundIndex++;

      const position = {
        coords: {
          latitude: Number(point.latitude),
          longitude: Number(point.longitude),
          accuracy: Number(point.accuracy),
          speed: Number(point.speed || 0)
        },
        timestamp: Number(point.timestamp)
      };

      if (
        Number.isFinite(position.coords.latitude) &&
        Number.isFinite(position.coords.longitude) &&
        Number.isFinite(position.timestamp)
      ) {
        onGPSSuccess(position);
      }
    }
  } catch (error) {
    console.error("Gagal mengambil GPS background:", error);
  } finally {
    backgroundPolling = false;
  }
}

async function startBackgroundPolling() {
  if (!backgroundPlugin) {
    throw new Error("Plugin GPS background tidak ditemukan.");
  }

  if (backgroundPollInterval) {
    clearInterval(backgroundPollInterval);
  }

  await backgroundPlugin.start();

  backgroundPollInterval = setInterval(
    pollBackgroundLocations,
    1500
  );

  await pollBackgroundLocations();
}

async function stopBackgroundPolling() {
  if (backgroundPollInterval) {
    clearInterval(backgroundPollInterval);
    backgroundPollInterval = null;
  }

  if (backgroundPlugin) {
    await backgroundPlugin.stop();
    await pollBackgroundLocations();
  }
}

// AMBIL TITIK SAAT APLIKASI KEMBALI AKTIF
document.addEventListener("visibilitychange", function () {
  if (!document.hidden && tracking && !paused) {
    pollBackgroundLocations();
  }
});

window.addEventListener("pageshow", function () {
  if (tracking && !paused) {
    pollBackgroundLocations();
  }
});

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

async function startTracking() {
  if (!navigator.geolocation) {
    alert("Browser tidak mendukung GPS.");
    return;
  }

  if (tracking && !paused) return;

  backgroundPlugin = getBackgroundPlugin();

  if (!backgroundPlugin) {
    alert("Plugin GPS background belum tersedia. Silakan periksa build Android.");
    return;
  }

  const isNewTrip = !tracking;

  try {
    if (isNewTrip) {
      resetTrip();
      lastProcessedBackgroundIndex = 0;
      await backgroundPlugin.clearLocations();
    }

    // HENTIKAN GPS BROWSER AGAR TIDAK MENGHITUNG TITIK GANDA
    if (watchId !== null) {
      navigator.geolocation.clearWatch(watchId);
      watchId = null;
    }

    await startBackgroundPolling();

    tracking = true;
    paused = false;
    previousPosition = null;

    if (gpsStatusElement) {
      gpsStatusElement.textContent = "GPS background aktif";
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

  } catch (error) {
    console.error("Gagal memulai GPS background:", error);

    tracking = false;
    paused = false;

    if (gpsStatusElement) {
      gpsStatusElement.textContent =
        "Gagal mengaktifkan GPS background";
    }

    alert("GPS background gagal dijalankan: " + error.message);

    startLocationWatch();
  }
}

// =========================================
// JEDA
// =========================================

async function pauseTracking() {
  if (!tracking || paused) return;

  try {
    await pollBackgroundLocations();
    await stopBackgroundPolling();

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

  } catch (error) {
    console.error("Gagal menjeda GPS:", error);
    alert("Gagal menjeda GPS: " + error.message);
  }
}

// =========================================
// STOP
// =========================================

async function stopTracking() {
  if (!tracking) return;

  try {
    await stopBackgroundPolling();

    if (timerInterval) {
      clearInterval(timerInterval);
      timerInterval = null;
    }

    // SIMPAN PERJALANAN KE RIWAYAT
    if (typeof saveTripToHistory === "function") {
      await saveTripToHistory();
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

    if (backgroundPlugin) {
      await backgroundPlugin.clearLocations();
    }

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

    // GPS BROWSER AKTIF KEMBALI
    startLocationWatch();

  } catch (error) {
    console.error("Gagal menghentikan GPS:", error);
    alert("Terjadi kesalahan saat menghentikan perjalanan: " + error.message);
  }
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

// GPS OTOMATIS SAAT APLIKASI DIBUKA
startLocationWatch();

console.log("GPS Speedometer Route Tracking siap.");
