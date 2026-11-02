
/* =========================================
   GPS SPEEDOMETER - RIWAYAT PERJALANAN
   IndexedDB + REPLAY DASHBOARD
   ========================================= */

const HISTORY_DB = "GPSSpeedometerDB";
const HISTORY_STORE = "trips";

let historyDB = null;

// =========================================
// VARIABEL REPLAY
// =========================================

let replayTimer = null;
let replayIndex = 0;
let replayCoordinates = [];
let replayPaused = false;
let replaySpeed = 1;
let replayMarker = null;
let replaySegmentProgress = 0;
let replaySegmentDuration = 500;
let replayTripData = null;
let replayElapsedMs = 0;

// =========================================
// BUKA DATABASE
// =========================================

function openHistoryDB() {
  return new Promise((resolve, reject) => {
    if (historyDB) {
      resolve(historyDB);
      return;
    }

    const request = indexedDB.open(HISTORY_DB, 1);

    request.onupgradeneeded = function (event) {
      const db = event.target.result;

      if (!db.objectStoreNames.contains(HISTORY_STORE)) {
        db.createObjectStore(HISTORY_STORE, {
          keyPath: "id",
          autoIncrement: true
        });
      }
    };

    request.onsuccess = function (event) {
      historyDB = event.target.result;
      resolve(historyDB);
    };

    request.onerror = function () {
      reject(request.error);
    };
  });
}

// =========================================
// SIMPAN PERJALANAN
// =========================================

async function saveTripToHistory() {
  try {
    const points = routeCoordinates.map(point => [
      point[0],
      point[1]
    ]);

    if (points.length < 2) {
      console.log("Rute terlalu pendek untuk disimpan.");
      return;
    }

    const averageSpeed = activeSeconds > 0
      ? totalDistance / (activeSeconds / 3600)
      : 0;

    const trip = {
      date: new Date().toISOString(),
      distance: Number(totalDistance.toFixed(3)),
      duration: activeSeconds,
      maxSpeed: Number(maxSpeed.toFixed(1)),
      avgSpeed: Number(averageSpeed.toFixed(1)),
      coordinates: points
    };

    const db = await openHistoryDB();

    await new Promise((resolve, reject) => {
      const transaction = db.transaction(
        HISTORY_STORE,
        "readwrite"
      );

      transaction.objectStore(HISTORY_STORE).add(trip);

      transaction.oncomplete = resolve;
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
    });

    alert("Perjalanan berhasil disimpan ke riwayat.");
    loadTripHistory();

  } catch (error) {
    console.error("Gagal menyimpan riwayat:", error);
    alert("Riwayat gagal disimpan. Periksa penyimpanan browser.");
  }
}

// =========================================
// AMBIL DATA RIWAYAT
// =========================================

async function getTripHistory() {
  const db = await openHistoryDB();

  return new Promise((resolve, reject) => {
    const transaction = db.transaction(
      HISTORY_STORE,
      "readonly"
    );

    const request = transaction
      .objectStore(HISTORY_STORE)
      .getAll();

    request.onsuccess = function () {
      const trips = request.result || [];
      trips.sort((a, b) => b.id - a.id);
      resolve(trips);
    };

    request.onerror = function () {
      reject(request.error);
    };
  });
}

// =========================================
// FORMAT DURASI
// =========================================

function formatHistoryDuration(seconds) {
  const safeSeconds = Math.max(0, Number(seconds) || 0);

  const h = Math.floor(safeSeconds / 3600);
  const m = Math.floor((safeSeconds % 3600) / 60);
  const s = Math.floor(safeSeconds % 60);

  return [
    String(h).padStart(2, "0"),
    String(m).padStart(2, "0"),
    String(s).padStart(2, "0")
  ].join(":");
}

// =========================================
// TAMPILKAN RIWAYAT
// =========================================

async function loadTripHistory() {
  const container = document.getElementById("historyList");

  if (!container) return;

  container.replaceChildren();

  try {
    const trips = await getTripHistory();

    const totalTripsElement =
      document.getElementById("totalTrips");

    const totalDistanceElement =
      document.getElementById("totalTripDistance");

    const totalDistance = trips.reduce(
      (total, trip) => total + Number(trip.distance || 0),
      0
    );

    if (totalTripsElement) {
      totalTripsElement.textContent = trips.length;
    }

    if (totalDistanceElement) {
      totalDistanceElement.textContent =
        totalDistance.toFixed(2) + " km";
    }

    if (trips.length === 0) {
      const empty = document.createElement("p");
      empty.textContent = "Belum ada riwayat perjalanan.";
      empty.style.color = "#94a3b8";
      container.appendChild(empty);
      return;
    }

    trips.forEach(trip => {
      const card = document.createElement("div");

      card.style.cssText = `
        background:#172235;
        border:1px solid #334155;
        border-radius:12px;
        padding:14px;
        margin-bottom:12px;
        color:#ffffff;
      `;

      const date = document.createElement("strong");
      date.textContent =
        new Date(trip.date).toLocaleString("id-ID");
      date.style.display = "block";

      const details = document.createElement("p");

      details.style.cssText = `
        color:#cbd5e1;
        font-size:13px;
        line-height:1.8;
        margin:8px 0;
        white-space:pre-line;
      `;

      details.textContent =
        "Jarak: " +
        Number(trip.distance || 0).toFixed(2) +
        " km | Durasi: " +
        formatHistoryDuration(trip.duration) +
        "\nMaksimum: " +
        Number(trip.maxSpeed || 0).toFixed(1) +
        " km/h | Rata-rata: " +
        Number(trip.avgSpeed || 0).toFixed(1) +
        " km/h";

      const buttons = document.createElement("div");

      buttons.style.cssText = `
        display:flex;
        gap:8px;
        flex-wrap:wrap;
      `;

      const viewButton = document.createElement("button");
      viewButton.textContent = "🗺️ Lihat Rute";

      viewButton.style.cssText = `
        background:#2563eb;
        color:white;
        border:0;
        border-radius:8px;
        padding:9px 14px;
        cursor:pointer;
      `;

      viewButton.addEventListener("click", function () {
        showTripRoute(trip.id);
      });

      const replayButton = document.createElement("button");
      replayButton.textContent = "▶ Replay";

      replayButton.style.cssText = `
        background:#16a34a;
        color:white;
        border:0;
        border-radius:8px;
        padding:9px 14px;
        cursor:pointer;
      `;

      replayButton.addEventListener("click", function () {
        startTripReplay(trip.id);
      });

      const deleteButton = document.createElement("button");
      deleteButton.textContent = "🗑️ Hapus";

      deleteButton.style.cssText = `
        background:#dc2626;
        color:white;
        border:0;
        border-radius:8px;
        padding:9px 14px;
        cursor:pointer;
      `;

      deleteButton.addEventListener("click", function () {
        deleteTripHistory(trip.id);
      });

      buttons.append(
        viewButton,
        replayButton,
        deleteButton
      );

      card.append(date, details, buttons);
      container.appendChild(card);
    });

  } catch (error) {
    console.error("Gagal membaca riwayat:", error);

    const message = document.createElement("p");
    message.textContent = "Riwayat gagal dimuat.";
    container.appendChild(message);
  }
}

// =========================================
// TAMPILKAN RUTE LAMA
// =========================================

async function showTripRoute(id) {
  stopTripReplay();

  if (tracking) {
    alert("Hentikan perjalanan aktif sebelum membuka riwayat.");
    return;
  }

  try {
    const trips = await getTripHistory();
    const trip = trips.find(item => item.id === id);

    if (!trip || !map || !routeLine) return;

    const coordinates = trip.coordinates;

    if (!coordinates || coordinates.length === 0) return;

    routeLine.setLatLngs(coordinates);

    if (startMarker) {
      map.removeLayer(startMarker);
      startMarker = null;
    }

    if (endMarker) {
      map.removeLayer(endMarker);
      endMarker = null;
    }

    startMarker = L.marker(coordinates[0], {
      icon: createMapIcon("🟢")
    }).addTo(map);

    startMarker.bindPopup("Titik Mulai");

    endMarker = L.marker(
      coordinates[coordinates.length - 1],
      {
        icon: createMapIcon("🔴")
      }
    ).addTo(map);

    endMarker.bindPopup("Titik Selesai");

    const bounds = L.latLngBounds(coordinates);

    map.fitBounds(bounds, {
      padding: [30, 30],
      maxZoom: 17
    });

    routeLine.bringToFront();

  } catch (error) {
    console.error("Gagal menampilkan rute:", error);
    alert("Rute tidak dapat ditampilkan.");
  }
}

// =========================================
// MULAI REPLAY
// =========================================

async function startTripReplay(id) {
  if (tracking) {
    alert("Hentikan perjalanan aktif sebelum menjalankan replay.");
    return;
  }

  try {
    const trips = await getTripHistory();
    const trip = trips.find(item => item.id === id);

    if (!trip) {
      alert("Data perjalanan tidak ditemukan.");
      return;
    }

    if (!trip.coordinates || trip.coordinates.length < 2) {
      alert("Rute perjalanan tidak cukup untuk replay.");
      return;
    }

    stopTripReplay();

    if (!map) {
      alert("Peta belum siap.");
      return;
    }

    replayTripData = trip;
    replayCoordinates = trip.coordinates;
    replayIndex = 0;
    replaySegmentProgress = 0;
    replayElapsedMs = 0;
    replayPaused = false;
    replaySpeed = 1;

    if (routeLine) {
      routeLine.setLatLngs(replayCoordinates);
      routeLine.bringToFront();
    }

    if (startMarker) {
      map.removeLayer(startMarker);
      startMarker = null;
    }

    if (endMarker) {
      map.removeLayer(endMarker);
      endMarker = null;
    }

    if (replayMarker) {
      map.removeLayer(replayMarker);
    }

    replayMarker = L.marker(replayCoordinates[0], {
      icon: createMapIcon("🏍️")
    }).addTo(map);

    replayMarker.bindPopup("Replay Perjalanan");

    const bounds = L.latLngBounds(replayCoordinates);

    map.fitBounds(bounds, {
      padding: [30, 30],
      maxZoom: 17
    });

    createReplayControls();
    updateReplayDashboard();
    runReplay();

  } catch (error) {
    console.error("Gagal memulai replay:", error);
    alert("Replay tidak dapat dijalankan.");
  }
}

// =========================================
// UPDATE DASHBOARD REPLAY
// =========================================

function updateReplayDashboard() {
  const total = replayCoordinates.length;

  const progress = total > 1
    ? Math.min(
        100,
        ((replayIndex + replaySegmentProgress) / (total - 1)) * 100
      )
    : 0;

  const progressBar =
    document.getElementById("replayProgressBar");

  const progressText =
    document.getElementById("replayProgressText");

  const pointText =
    document.getElementById("replayPointText");

  const elapsedText =
    document.getElementById("replayElapsed");

  if (progressBar) {
    progressBar.style.width = progress + "%";
  }

  if (progressText) {
    progressText.textContent = Math.floor(progress) + "%";
  }

  if (pointText) {
    pointText.textContent =
      Math.min(replayIndex + 1, total) + " / " + total;
  }

  if (elapsedText) {
    elapsedText.textContent =
      formatHistoryDuration(replayElapsedMs / 1000);
  }
}

// =========================================
// JALANKAN REPLAY HALUS
// =========================================

function runReplay() {
  clearInterval(replayTimer);

  replayTimer = setInterval(function () {
    if (replayPaused || !replayCoordinates.length) return;

    if (replayIndex >= replayCoordinates.length - 1) {
      finishTripReplay();
      return;
    }

    replaySegmentProgress +=
      (50 * replaySpeed) / replaySegmentDuration;

    replayElapsedMs += 50 * replaySpeed;

    if (replaySegmentProgress >= 1) {
      replayIndex++;
      replaySegmentProgress = 0;
    }

    const start = replayCoordinates[replayIndex];

    const end = replayCoordinates[
      Math.min(replayIndex + 1, replayCoordinates.length - 1)
    ];

    const lat =
      start[0] + (end[0] - start[0]) * replaySegmentProgress;

    const lng =
      start[1] + (end[1] - start[1]) * replaySegmentProgress;

    const position = [lat, lng];

    if (replayMarker) {
      replayMarker.setLatLng(position);
    }

    if (map) {
      map.panTo(position, { animate: false });
    }

    updateReplayDashboard();

    if (replayIndex >= replayCoordinates.length - 1) {
      finishTripReplay();
    }
  }, 50);
}

// =========================================
// PAUSE / LANJUT REPLAY
// =========================================

function toggleReplayPause() {
  if (!replayCoordinates.length) return;

  if (
    replayIndex >= replayCoordinates.length - 1 &&
    !replayTimer
  ) {
    return;
  }

  replayPaused = !replayPaused;

  const pauseButton =
    document.getElementById("replayPauseButton");

  if (pauseButton) {
    pauseButton.textContent =
      replayPaused ? "▶ Lanjut" : "Ⅱ Jeda";
  }
}

// =========================================
// UBAH KECEPATAN REPLAY
// =========================================

function changeReplaySpeed(speed) {
  replaySpeed = Number(speed);

  if (
    replayCoordinates.length &&
    !replayPaused &&
    replayTimer
  ) {
    runReplay();
  }
}

// =========================================
// STOP REPLAY
// =========================================

function stopTripReplay() {
  if (replayTimer) {
    clearInterval(replayTimer);
    replayTimer = null;
  }

  replayCoordinates = [];
  replayIndex = 0;
  replaySegmentProgress = 0;
  replayElapsedMs = 0;
  replayPaused = false;
  replaySpeed = 1;
  replayTripData = null;

  if (replayMarker && map) {
    map.removeLayer(replayMarker);
    replayMarker = null;
  }

  const controls =
    document.getElementById("replayControls");

  if (controls) {
    controls.remove();
  }
}

// =========================================
// REPLAY SELESAI
// =========================================

function finishTripReplay() {
  if (replayTimer) {
    clearInterval(replayTimer);
    replayTimer = null;
  }

  replayPaused = false;
  replayIndex = replayCoordinates.length - 1;
  replaySegmentProgress = 0;

  if (replayMarker && replayCoordinates.length) {
    replayMarker.setLatLng(
      replayCoordinates[replayCoordinates.length - 1]
    );
  }

  updateReplayDashboard();

  const button =
    document.getElementById("replayPauseButton");

  if (button) {
    button.textContent = "✓ Selesai";
    button.disabled = true;
  }
}

// =========================================
// BUAT PANEL DASHBOARD REPLAY
// =========================================

function createReplayControls() {
  const oldControls =
    document.getElementById("replayControls");

  if (oldControls) oldControls.remove();

  const trip = replayTripData;

  const controls = document.createElement("div");
  controls.id = "replayControls";

  controls.style.cssText = `
    margin:12px 0;
    padding:15px;
    background:#172235;
    border:1px solid #334155;
    border-radius:14px;
    color:white;
  `;

  const title = document.createElement("strong");
  title.textContent = "🏍️ REPLAY PERJALANAN";
  title.style.cssText =
    "display:block;font-size:16px;margin-bottom:14px;";

  const stats = document.createElement("div");

  stats.style.cssText = `
    display:grid;
    grid-template-columns:1fr 1fr;
    gap:10px;
    margin-bottom:14px;
  `;

  function createStat(label, value) {
    const box = document.createElement("div");

    box.style.cssText =
      "background:#0f172a;padding:12px;border-radius:9px;";

    const small = document.createElement("small");
    small.textContent = label;
    small.style.color = "#94a3b8";

    const strong = document.createElement("strong");
    strong.textContent = value;
    strong.style.cssText =
      "display:block;font-size:20px;margin-top:5px;";

    box.append(small, strong);

    return box;
  }

  stats.append(
    createStat(
      "JARAK",
      Number(trip.distance || 0).toFixed(2) + " km"
    ),
    createStat(
      "DURASI ASLI",
      formatHistoryDuration(trip.duration || 0)
    )
  );

  const progressBox = document.createElement("div");
  progressBox.style.marginBottom = "14px";

  const progressHeader = document.createElement("div");

  progressHeader.style.cssText = `
    display:flex;
    justify-content:space-between;
    margin-bottom:6px;
  `;

  const progressLabel = document.createElement("small");
  progressLabel.textContent = "Progress perjalanan";
  progressLabel.style.color = "#cbd5e1";

  const elapsedText = document.createElement("small");
  elapsedText.id = "replayElapsed";
  elapsedText.textContent = "00:00:00";

  progressHeader.append(progressLabel, elapsedText);

  const progressTrack = document.createElement("div");

  progressTrack.style.cssText = `
    height:9px;
    background:#334155;
    border-radius:20px;
    overflow:hidden;
  `;

  const progressBar = document.createElement("div");
  progressBar.id = "replayProgressBar";

  progressBar.style.cssText = `
    width:0%;
    height:100%;
    background:#16a34a;
    border-radius:20px;
    transition:width .05s linear;
  `;

  progressTrack.appendChild(progressBar);
  progressBox.append(progressHeader, progressTrack);

  const progressInfo = document.createElement("div");

  progressInfo.style.cssText = `
    display:flex;
    justify-content:space-between;
    margin:0 0 14px;
  `;

  const progressText = document.createElement("strong");
  progressText.id = "replayProgressText";
  progressText.textContent = "0%";

  const pointText = document.createElement("small");
  pointText.id = "replayPointText";
  pointText.textContent =
    "1 / " + replayCoordinates.length;
  pointText.style.color = "#cbd5e1";

  progressInfo.append(progressText, pointText);

  const row = document.createElement("div");

  row.style.cssText = `
    display:flex;
    gap:8px;
    flex-wrap:wrap;
    align-items:center;
  `;

  const pauseButton = document.createElement("button");
  pauseButton.id = "replayPauseButton";
  pauseButton.textContent = "Ⅱ Jeda";

  pauseButton.style.cssText = `
    background:#f59e0b;
    color:white;
    border:0;
    border-radius:8px;
    padding:10px 14px;
  `;

  pauseButton.addEventListener(
    "click",
    toggleReplayPause
  );

  const stopButton = document.createElement("button");
  stopButton.textContent = "■ Stop";

  stopButton.style.cssText = `
    background:#dc2626;
    color:white;
    border:0;
    border-radius:8px;
    padding:10px 14px;
  `;

  stopButton.addEventListener(
    "click",
    stopTripReplay
  );

  const speedSelect = document.createElement("select");

  speedSelect.style.cssText = `
    background:#0f172a;
    color:white;
    border:1px solid #475569;
    border-radius:8px;
    padding:9px;
  `;

  [["1", "1×"], ["2", "2×"], ["4", "4×"]].forEach(item => {
    const option = document.createElement("option");
    option.value = item[0];
    option.textContent = item[1];
    speedSelect.appendChild(option);
  });

  speedSelect.value = "1";

  speedSelect.addEventListener("change", function () {
    changeReplaySpeed(this.value);
  });

  row.append(pauseButton, stopButton, speedSelect);

  controls.append(
    title,
    stats,
    progressBox,
    progressInfo,
    row
  );

  const historySection =
    document.querySelector(".history-section");

  const historyList =
    document.getElementById("historyList");

  if (historySection && historyList) {
    historySection.insertBefore(controls, historyList);
  }
}

// =========================================
// HAPUS SATU RIWAYAT
// =========================================

async function deleteTripHistory(id) {
  if (!confirm("Hapus riwayat perjalanan ini?")) return;

  stopTripReplay();

  try {
    const db = await openHistoryDB();

    await new Promise((resolve, reject) => {
      const transaction = db.transaction(
        HISTORY_STORE,
        "readwrite"
      );

      transaction.objectStore(HISTORY_STORE).delete(id);

      transaction.oncomplete = resolve;
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
    });

    loadTripHistory();

  } catch (error) {
    console.error("Gagal menghapus riwayat:", error);
    alert("Riwayat gagal dihapus.");
  }
}

// =========================================
// HAPUS SEMUA RIWAYAT
// =========================================

async function clearTripHistory() {
  if (!confirm("Yakin ingin menghapus SEMUA riwayat?")) return;

  stopTripReplay();

  try {
    const db = await openHistoryDB();

    await new Promise((resolve, reject) => {
      const transaction = db.transaction(
        HISTORY_STORE,
        "readwrite"
      );

      transaction.objectStore(HISTORY_STORE).clear();

      transaction.oncomplete = resolve;
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
    });

    loadTripHistory();

  } catch (error) {
    console.error("Gagal menghapus semua riwayat:", error);
    alert("Riwayat gagal dihapus.");
  }
}

// =========================================
// JALANKAN RIWAYAT
// =========================================

loadTripHistory();
