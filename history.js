/* =========================================
   GPS SPEEDOMETER - RIWAYAT PERJALANAN
   Penyimpanan: IndexedDB
   + REPLAY PERJALANAN
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
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);

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

    // =====================================
    // TOTAL RIWAYAT
    // =====================================

    const totalTripsElement =
      document.getElementById("totalTrips");

    const totalDistanceElement =
      document.getElementById("totalTripDistance");

    const totalDistance = trips.reduce(
      (total, trip) =>
        total + Number(trip.distance || 0),
      0
    );

    if (totalTripsElement) {
      totalTripsElement.textContent = trips.length;
    }

    if (totalDistanceElement) {
      totalDistanceElement.textContent =
        totalDistance.toFixed(2) + " km";
    }

    // =====================================
    // JIKA KOSONG
    // =====================================

    if (trips.length === 0) {
      const empty = document.createElement("p");

      empty.textContent =
        "Belum ada riwayat perjalanan.";

      empty.style.color = "#94a3b8";

      container.appendChild(empty);

      return;
    }

    // =====================================
    // TAMPILKAN SETIAP PERJALANAN
    // =====================================

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

      // TANGGAL
      const date = document.createElement("strong");

      date.textContent =
        new Date(trip.date).toLocaleString("id-ID");

      date.style.display = "block";

      // DETAIL
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
        " km | " +
        "Durasi: " +
        formatHistoryDuration(trip.duration) +
        "\nMaksimum: " +
        Number(trip.maxSpeed || 0).toFixed(1) +
        " km/h | " +
        "Rata-rata: " +
        Number(trip.avgSpeed || 0).toFixed(1) +
        " km/h";

      // ===================================
      // AREA TOMBOL
      // ===================================

      const buttons = document.createElement("div");

      buttons.style.cssText = `
        display:flex;
        gap:8px;
        flex-wrap:wrap;
      `;

      // ===================================
      // TOMBOL LIHAT RUTE
      // ===================================

      const viewButton =
        document.createElement("button");

      viewButton.textContent = "🗺️ Lihat Rute";

      viewButton.style.cssText = `
        background:#2563eb;
        color:white;
        border:0;
        border-radius:8px;
        padding:9px 14px;
        cursor:pointer;
      `;

      viewButton.addEventListener(
        "click",
        function () {
          showTripRoute(trip.id);
        }
      );

      // ===================================
      // TOMBOL REPLAY
      // ===================================

      const replayButton =
        document.createElement("button");

      replayButton.textContent = "▶ Replay";

      replayButton.style.cssText = `
        background:#16a34a;
        color:white;
        border:0;
        border-radius:8px;
        padding:9px 14px;
        cursor:pointer;
      `;

      replayButton.addEventListener(
        "click",
        function () {
          startTripReplay(trip.id);
        }
      );

      // ===================================
      // TOMBOL HAPUS
      // ===================================

      const deleteButton =
        document.createElement("button");

      deleteButton.textContent = "🗑️ Hapus";

      deleteButton.style.cssText = `
        background:#dc2626;
        color:white;
        border:0;
        border-radius:8px;
        padding:9px 14px;
        cursor:pointer;
      `;

      deleteButton.addEventListener(
        "click",
        function () {
          deleteTripHistory(trip.id);
        }
      );

      buttons.append(
        viewButton,
        replayButton,
        deleteButton
      );

      card.append(
        date,
        details,
        buttons
      );

      container.appendChild(card);
    });

  } catch (error) {

    console.error(
      "Gagal membaca riwayat:",
      error
    );

    const message =
      document.createElement("p");

    message.textContent =
      "Riwayat gagal dimuat.";

    container.appendChild(message);
  }
}

// =========================================
// TAMPILKAN RUTE LAMA
// =========================================

async function showTripRoute(id) {

  stopTripReplay();

  if (tracking) {

    alert(
      "Hentikan perjalanan aktif sebelum membuka riwayat."
    );

    return;
  }

  try {

    const trips =
      await getTripHistory();

    const trip =
      trips.find(item => item.id === id);

    if (!trip || !map || !routeLine) {
      return;
    }

    const coordinates =
      trip.coordinates;

    if (
      !coordinates ||
      coordinates.length === 0
    ) {
      return;
    }

    routeLine.setLatLngs(
      coordinates
    );

    if (startMarker) {
      map.removeLayer(startMarker);
    }

    if (endMarker) {
      map.removeLayer(endMarker);
    }

    startMarker =
      L.marker(
        coordinates[0],
        {
          icon: createMapIcon("🟢")
        }
      ).addTo(map);

    startMarker.bindPopup(
      "Titik Mulai"
    );

    endMarker =
      L.marker(
        coordinates[coordinates.length - 1],
        {
          icon: createMapIcon("🔴")
        }
      ).addTo(map);

    endMarker.bindPopup(
      "Titik Selesai"
    );

    const bounds =
      L.latLngBounds(
        coordinates
      );

    map.fitBounds(
      bounds,
      {
        padding: [30, 30],
        maxZoom: 17
      }
    );

    routeLine.bringToFront();

  } catch (error) {

    console.error(
      "Gagal menampilkan rute:",
      error
    );

    alert(
      "Rute tidak dapat ditampilkan."
    );
  }
}

// =========================================
// MULAI REPLAY
// =========================================

async function startTripReplay(id) {

  if (tracking) {

    alert(
      "Hentikan perjalanan aktif sebelum menjalankan replay."
    );

    return;
  }

  try {

    const trips =
      await getTripHistory();

    const trip =
      trips.find(item => item.id === id);

    if (!trip) {

      alert(
        "Data perjalanan tidak ditemukan."
      );

      return;
    }

    if (
      !trip.coordinates ||
      trip.coordinates.length < 2
    ) {

      alert(
        "Rute perjalanan tidak cukup untuk replay."
      );

      return;
    }

    // Hentikan replay sebelumnya
    stopTripReplay();

    replayCoordinates =
      trip.coordinates;

    replayIndex = 0;
    replayPaused = false;
    replaySpeed = 1;

    // Pastikan map tersedia
    if (!map) {
      alert("Peta belum siap.");
      return;
    }

    // Tampilkan rute
    if (routeLine) {

      routeLine.setLatLngs(
        replayCoordinates
      );

      routeLine.bringToFront();
    }

    // Hapus marker lama
    if (startMarker) {
      map.removeLayer(startMarker);
      startMarker = null;
    }

    if (endMarker) {
      map.removeLayer(endMarker);
      endMarker = null;
    }

    // =====================================
    // MARKER REPLAY
    // =====================================

    if (replayMarker) {
      map.removeLayer(replayMarker);
    }

    replayMarker =
      L.marker(
        replayCoordinates[0],
        {
          icon: createMapIcon("🏍️")
        }
      ).addTo(map);

    replayMarker.bindPopup(
      "Replay Perjalanan"
    );

    // =====================================
    // FIT MAP
    // =====================================

    const bounds =
      L.latLngBounds(
        replayCoordinates
      );

    map.fitBounds(
      bounds,
      {
        padding: [30, 30],
        maxZoom: 17
      }
    );

    // =====================================
    // PANEL KONTROL REPLAY
    // =====================================

    createReplayControls();

    // Mulai replay
    runReplay();

  } catch (error) {

    console.error(
      "Gagal memulai replay:",
      error
    );

    alert(
      "Replay tidak dapat dijalankan."
    );
  }
}

// =========================================
// JALANKAN REPLAY
// =========================================

function runReplay() {

  clearInterval(replayTimer);

  replayTimer =
    setInterval(
      function () {

        if (replayPaused) {
          return;
        }

        if (
          replayIndex >=
          replayCoordinates.length
        ) {

          finishTripReplay();

          return;
        }

        const point =
          replayCoordinates[
            replayIndex
          ];

        if (replayMarker) {

          replayMarker.setLatLng(
            point
          );
        }

        // Ikuti marker
        if (map) {

          map.panTo(
            point,
            {
              animate: true,
              duration: 0.2
            }
          );
        }

        replayIndex++;

      },
      Math.max(
        80,
        500 / replaySpeed
      )
    );
}

// =========================================
// PAUSE / LANJUT REPLAY
// =========================================

function toggleReplayPause() {

  if (!replayCoordinates.length) {
    return;
  }

  replayPaused =
    !replayPaused;

  const button =
    document.getElementById(
      "replayPauseButton"
    );

  if (button) {

    button.textContent =
      replayPaused
        ? "▶ Lanjut"
        : "Ⅱ Jeda";
  }
}

// =========================================
// UBAH KECEPATAN REPLAY
// =========================================

function changeReplaySpeed(speed) {

  replaySpeed =
    Number(speed);

  if (
    replayCoordinates.length &&
    !replayPaused
  ) {

    runReplay();
  }

  const label =
    document.getElementById(
      "replaySpeedLabel"
    );

  if (label) {

    label.textContent =
      replaySpeed + "×";
  }
}

// =========================================
// STOP REPLAY
// =========================================

function stopTripReplay() {

  if (replayTimer) {

    clearInterval(
      replayTimer
    );

    replayTimer = null;
  }

  replayCoordinates = [];

  replayIndex = 0;

  replayPaused = false;

  replaySpeed = 1;

  if (replayMarker && map) {

    map.removeLayer(
      replayMarker
    );

    replayMarker = null;
  }

  const controls =
    document.getElementById(
      "replayControls"
    );

  if (controls) {
    controls.remove();
  }
}

// =========================================
// REPLAY SELESAI
// =========================================

function finishTripReplay() {

  clearInterval(
    replayTimer
  );

  replayTimer = null;

  replayPaused = false;

  const button =
    document.getElementById(
      "replayPauseButton"
    );

  if (button) {

    button.textContent =
      "✓ Selesai";
  }
}

// =========================================
// BUAT PANEL KONTROL REPLAY
// =========================================

function createReplayControls() {

  const oldControls =
    document.getElementById(
      "replayControls"
    );

  if (oldControls) {
    oldControls.remove();
  }

  const controls =
    document.createElement("div");

  controls.id =
    "replayControls";

  controls.style.cssText = `
    margin-top:12px;
    padding:12px;
    background:#172235;
    border:1px solid #334155;
    border-radius:12px;
    color:white;
  `;

  const title =
    document.createElement("strong");

  title.textContent =
    "🏍️ Replay Perjalanan";

  title.style.display =
    "block";

  title.style.marginBottom =
    "10px";

  const row =
    document.createElement("div");

  row.style.cssText = `
    display:flex;
    gap:8px;
    flex-wrap:wrap;
    align-items:center;
  `;

  // JEDA
  const pauseButton =
    document.createElement("button");

  pauseButton.id =
    "replayPauseButton";

  pauseButton.textContent =
    "Ⅱ Jeda";

  pauseButton.style.cssText = `
    background:#f59e0b;
    color:white;
    border:0;
    border-radius:8px;
    padding:9px 13px;
  `;

  pauseButton.addEventListener(
    "click",
    toggleReplayPause
  );

  // STOP
  const stopButton =
    document.createElement("button");

  stopButton.textContent =
    "■ Stop";

  stopButton.style.cssText = `
    background:#dc2626;
    color:white;
    border:0;
    border-radius:8px;
    padding:9px 13px;
  `;

  stopButton.addEventListener(
    "click",
    stopTripReplay
  );

  // LABEL KECEPATAN
  const speedText =
    document.createElement("span");

  speedText.textContent =
    "Kecepatan:";

  speedText.style.color =
    "#cbd5e1";

  // SELECT KECEPATAN
  const speedSelect =
    document.createElement("select");

  speedSelect.style.cssText = `
    background:#0f172a;
    color:white;
    border:1px solid #475569;
    border-radius:8px;
    padding:8px;
  `;

  [
    ["1", "1×"],
    ["2", "2×"],
    ["4", "4×"]
  ].forEach(function (item) {

    const option =
      document.createElement("option");

    option.value =
      item[0];

    option.textContent =
      item[1];

    speedSelect.appendChild(
      option
    );
  });

  speedSelect.value = "1";

  speedSelect.addEventListener(
    "change",
    function () {

      changeReplaySpeed(
        this.value
      );
    }
  );

  row.append(
    pauseButton,
    stopButton,
    speedText,
    speedSelect
  );

  controls.append(
    title,
    row
  );

  const historySection =
    document.querySelector(
      ".history-section"
    );

  if (historySection) {

    const historyList =
      document.getElementById(
        "historyList"
      );

    historySection.insertBefore(
      controls,
      historyList
    );
  }
}

// =========================================
// HAPUS SATU RIWAYAT
// =========================================

async function deleteTripHistory(id) {

  if (
    !confirm(
      "Hapus riwayat perjalanan ini?"
    )
  ) {
    return;
  }

  // Hentikan replay jika sedang berjalan
  stopTripReplay();

  try {

    const db =
      await openHistoryDB();

    await new Promise(
      (resolve, reject) => {

        const transaction =
          db.transaction(
            HISTORY_STORE,
            "readwrite"
          );

        transaction
          .objectStore(
            HISTORY_STORE
          )
          .delete(id);

        transaction.oncomplete =
          resolve;

        transaction.onerror =
          () => reject(
            transaction.error
          );
      }
    );

    loadTripHistory();

  } catch (error) {

    console.error(
      "Gagal menghapus riwayat:",
      error
    );

    alert(
      "Riwayat gagal dihapus."
    );
  }
}

// =========================================
// HAPUS SEMUA RIWAYAT
// =========================================

async function clearTripHistory() {

  if (
    !confirm(
      "Yakin ingin menghapus SEMUA riwayat?"
    )
  ) {
    return;
  }

  stopTripReplay();

  try {

    const db =
      await openHistoryDB();

    await new Promise(
      (resolve, reject) => {

        const transaction =
          db.transaction(
            HISTORY_STORE,
            "readwrite"
          );

        transaction
          .objectStore(
            HISTORY_STORE
          )
          .clear();

        transaction.oncomplete =
          resolve;

        transaction.onerror =
          () => reject(
            transaction.error
          );
      }
    );

    loadTripHistory();

  } catch (error) {

    console.error(
      "Gagal menghapus semua riwayat:",
      error
    );

    alert(
      "Riwayat gagal dihapus."
    );
  }
}

// =========================================
// JALANKAN RIWAYAT
// =========================================

loadTripHistory();