
/* =========================================
   GPS SPEEDOMETER - STABLE GPS TRACKING
   GPS OTOMATIS + BACKGROUND LOCATION
   ========================================= */

// PENGATURAN GPS
const MIN_ACCURACY = 50;
const MIN_MOVEMENT = 2;
const MAX_JUMP_DISTANCE = 100;
const MAX_SPEED = 180;

// DATA GPS
let watchId = null;
let backgroundPollInterval = null;
let lastProcessedBackgroundIndex = 0;
let backgroundPolling = false;
let backgroundPlugin = null;

let timerInterval = null;

let map = null;
let motorMarker = null;
let startMarker = null;
let endMarker = null;
let routeLine = null;

let previousPosition = null;
let lastPosition = null;
let lastAcceptedFix = null;

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

        setTimeout(function () {
          loadMapSource(sourceIndex + 1);
        }, 1500);
      }
    });

    currentLayer.addTo(map);
  }

  loadMapSource(0);

  motorMarker = L.marker([-2.5, 118], {
    icon: createMapIcon("🏍️")
  }).addTo(map);

  routeLine = L.polyline([], {
    color: "#168cff",
    weight: 5,
    opacity: 0.9,
    lineCap: "round",
    lineJoin: "round"
  }).addTo(map);

  setTimeout(function () {
    map.invalidateSize();

    if (lastPosition) {
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

  const previous = routeCoordinates[
    routeCoordinates.length - 1
  ];

  if (previous) {
    const distance = calculateDistance(
      previous[0],
      previous[1],
      lat,
      lon
    );

    if (distance < 1) return;
  }

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
// VALIDASI KOORDINAT GPS
// =========================================

function validateGPSPosition(position, source) {
  if (!position || !position.coords) return false;

  const lat = Number(position.coords.latitude);
  const lon = Number(position.coords.longitude);
  const accuracy = Number(position.coords.accuracy);
  const timestamp = Number(position.timestamp);

  if (
    !Number.isFinite(lat) ||
    !Number.isFinite(lon) ||
    !Number.isFinite(accuracy) ||
    !Number.isFinite(timestamp)
  ) {
    return false;
  }

  if (
    lat < -90 || lat > 90 ||
    lon < -180 || lon > 180
  ) {
    return false;
  }

  if (accuracy <= 0 || accuracy > MIN_ACCURACY) {
    if (gpsStatusElement) {
      gpsStatusElement.textContent =
        "Menunggu GPS lebih akurat: " +
        Math.round(accuracy) + " m";
    }

    return false;
  }

  // GPS browser tidak boleh mengubah posisi
  // ketika perjalanan menggunakan GPS background.
  if (source === "browser" && tracking) {
    return false;
  }

  // GPS background hanya diproses ketika perjalanan aktif.
  if (source === "background" && (!tracking || paused)) {
    return false;
  }

  // Tolak koordinat yang waktunya mundur.
  if (
    lastAcceptedFix &&
    timestamp <= lastAcceptedFix.timestamp
  ) {
    return false;
  }

  const reference = tracking && !paused
    ? previousPosition
    : lastAcceptedFix;

  if (reference) {
    const distance = calculateDistance(
      reference.lat,
      reference.lon,
      lat,
      lon
    );

    const elapsed =
      (timestamp - reference.timestamp) / 1000;

    if (elapsed <= 0) return false;

    // Batas jarak berdasarkan waktu, kecepatan,
    // dan radius ketidakpastian GPS.
    const allowedDistance =
      (MAX_SPEED / 3.6) * elapsed +
      accuracy +
      (reference.accuracy || 0) +
      10;

    if (distance > allowedDistance) {
      console.warn("GPS ditolak: lonjakan koordinat", {
        distance,
        allowedDistance,
        accuracy
      });

      if (gpsStatusElement) {
        gpsStatusElement.textContent =
          "GPS tidak stabil, menunggu posisi valid...";
      }

      return false;
    }

    // Filter tambahan khusus pencatatan perjalanan.
    if (tracking && !paused) {
      if (distance > MAX_JUMP_DISTANCE) {
        console.warn("GPS ditolak: perpindahan terlalu jauh");
        return false;
      }

      const speed = (distance / elapsed) * 3.6;

      if (speed > MAX_SPEED) {
        console.warn("GPS ditolak: kecepatan tidak wajar");
        return false;
      }
    }
  }

  return true;
}

// =========================================
// GPS BERHASIL
// =========================================

function onGPSSuccess(position, source = "browser") {
  const coords = position.coords;

  const lat = Number(coords.latitude);
  const lon = Number(coords.longitude);
  const accuracy = Number(coords.accuracy);
  const timestamp = Number(position.timestamp);

  if (accuracyElement && Number.isFinite(accuracy)) {
    accuracyElement.textContent =
      "Akurasi: " + Math.round(accuracy) + " m";
  }

  // Jangan pindahkan marker sebelum validasi.
  if (!validateGPSPosition(position, source)) {
    return;
  }

  const acceptedFix = {
    lat,
    lon,
    accuracy,
    timestamp
  };

  // Simpan hanya koordinat yang lolos validasi.
  lastAcceptedFix = acceptedFix;
  lastPosition = [lat, lon];

  if (coordinatesElement) {
    coordinatesElement.textContent =
      lat.toFixed(6) + ", " + lon.toFixed(6);
  }

  updateMapPosition(lat, lon);

  if (gpsStatusElement) {
    gpsStatusElement.textContent = tracking
      ? "GPS Aktif"
      : "Lokasi ditemukan";
  }

  if (!tracking || paused) {
    return;
  }

  if (!previousPosition) {
    previousPosition = acceptedFix;

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
    (timestamp - previousPosition.timestamp) / 1000;

  if (elapsed <= 0) return;

  const calculatedSpeed = (distance / elapsed) * 3.6;

  if (
    distance > MAX_JUMP_DISTANCE ||
    calculatedSpeed > MAX_SPEED
  ) {
    console.warn("Titik rute ditolak karena tidak wajar");
    return;
  }

  if (distance >= MIN_MOVEMENT) {
    totalDistance += distance / 1000;

    let gpsSpeed =
      coords.speed !== null &&
      coords.speed !== undefined
        ? Number(coords.speed) * 3.6
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

  previousPosition = acceptedFix;

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
// GPS OTOMATIS
// =========================================

function startLocationWatch() {
  if (!navigator.geolocation) {
    if (gpsStatusElement) {
      gpsStatusElement.textContent =
        "Browser tidak mendukung GPS";
    }

    return;
  }

  if (watchId !== null || tracking) return;

  if (gpsStatusElement) {
    gpsStatusElement.textContent = "Mencari lokasi GPS...";
  }

  // Gunakan GPS akurasi tinggi.
  // Tidak menggunakan lokasi cache lama.
  navigator.geolocation.getCurrentPosition(
    function (position) {
      if (!tracking) {
        onGPSSuccess(position, "browser");
      }
    },
    onGPSError,
    {
      enableHighAccuracy: true,
      maximumAge: 0,
      timeout: 20000
    }
  );

  watchId = navigator.geolocation.watchPosition(
    function (position) {
      if (!tracking) {
        onGPSSuccess(position, "browser");
      }
    },
    onGPSError,
    {
      enableHighAccuracy: true,
      maximumAge: 0,
      timeout: 20000
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

      let timestamp = Number(point.timestamp);

      // Pastikan timestamp menggunakan milidetik.
      if (timestamp > 0 && timestamp < 1000000000000) {
        timestamp *= 1000;
      }

      const position = {
        coords: {
          latitude: Number(point.latitude),
          longitude: Number(point.longitude),
          accuracy: Number(point.accuracy),
          speed: Number(point.speed || 0)
        },
        timestamp
      };

      if (
        Number.isFinite(position.coords.latitude) &&
        Number.isFinite(position.coords.longitude) &&
        Number.isFinite(position.coords.accuracy) &&
        Number.isFinite(position.timestamp)
      ) {
        onGPSSuccess(position, "background");
      }
    }
  } catch (error) {
    console.error(
      "Gagal mengambil GPS background:",
      error
    );
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
    backgroundPollInterval = null;
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

// =========================================
// SAAT APLIKASI KEMBALI AKTIF
// =========================================

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
// MULAI / LANJUTKAN PERJALANAN
// =========================================

async function startTracking() {
  if (!navigator.geolocation) {
    alert("Browser tidak mendukung GPS.");
    return;
  }

  if (tracking && !paused) return;

  backgroundPlugin = getBackgroundPlugin();

  if (!backgroundPlugin) {
    alert(
      "Plugin GPS background belum tersedia. " +
      "Silakan periksa build Android."
    );

    return;
  }

  const isNewTrip = !tracking;

  try {
    if (isNewTrip) {
      resetTrip();

      lastProcessedBackgroundIndex = 0;

      await backgroundPlugin.clearLocations();

      // Gunakan titik GPS valid terakhir
      // sebagai titik awal perjalanan.
      if (lastAcceptedFix && map) {
        const age = Date.now() - lastAcceptedFix.timestamp;

        if (age >= 0 && age <= 60000) {
          previousPosition = lastAcceptedFix;

          addRoutePoint(
            lastAcceptedFix.lat,
            lastAcceptedFix.lon
          );
        }
      }
    } else {
      // Saat melanjutkan perjalanan,
      // jangan menghitung jarak selama jeda.
      previousPosition = null;
      speedSamples = [];
      currentSpeed = 0;
    }

    // Hentikan GPS browser.
    if (watchId !== null) {
      navigator.geolocation.clearWatch(watchId);
      watchId = null;
    }

    // Aktifkan status tracking sebelum polling pertama.
    tracking = true;
    paused = false;

    await startBackgroundPolling();

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

    alert(
      "GPS background gagal dijalankan: " +
      error.message
    );

    startLocationWatch();
  }
}

// =========================================
// JEDA PERJALANAN
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
// SELESAI PERJALANAN
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

    // TITIK AKHIR PERJALANAN
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

    // GPS browser aktif kembali.
    startLocationWatch();

  } catch (error) {
    console.error("Gagal menghentikan GPS:", error);

    alert(
      "Terjadi kesalahan saat menghentikan GPS: " +
      error.message
    );
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

// GPS otomatis saat aplikasi dibuka.
startLocationWatch();

console.log("GPS Speedometer Stable Tracking siap.");

// =========================================
// PERBAIKAN UKURAN PETA
// =========================================

function refreshMapSize() {
  try {
    if (map) {
      setTimeout(() => map.invalidateSize(true), 100);
      setTimeout(() => map.invalidateSize(true), 500);
      setTimeout(() => map.invalidateSize(true), 1000);
    }
  } catch (error) {
    console.warn("Map resize:", error);
  }
}

window.addEventListener("resize", refreshMapSize);
window.addEventListener("orientationchange", refreshMapSize);

document.addEventListener("visibilitychange", function () {
  if (!document.hidden) {
    refreshMapSize();
  }
});
