
/* =========================================
   GPS SPEEDOMETER - RIWAYAT PERJALANAN
   Penyimpanan: IndexedDB
   ========================================= */

const HISTORY_DB = "GPSSpeedometerDB";
const HISTORY_STORE = "trips";

let historyDB = null;

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
      date.textContent = new Date(trip.date).toLocaleString("id-ID");
      date.style.display = "block";

      const details = document.createElement("p");
      details.style.cssText = `
        color:#cbd5e1;
        font-size:13px;
        line-height:1.8;
        margin:8px 0;
      `;

      details.textContent =
        "Jarak: " + trip.distance.toFixed(2) + " km | " +
        "Durasi: " + formatHistoryDuration(trip.duration) +
        "\nMaksimum: " + trip.maxSpeed.toFixed(1) + " km/h | " +
        "Rata-rata: " + trip.avgSpeed.toFixed(1) + " km/h";

      const buttons = document.createElement("div");
      buttons.style.cssText = `
        display:flex;
        gap:8px;
        flex-wrap:wrap;
      `;

      const viewButton = document.createElement("button");
      viewButton.textContent = "Lihat Rute";
      viewButton.style.cssText = `
        background:#2563eb;
        color:white;
        border:0;
        border-radius:8px;
        padding:9px 14px;
      `;

      viewButton.addEventListener("click", function () {
        showTripRoute(trip.id);
      });

      const deleteButton = document.createElement("button");
      deleteButton.textContent = "Hapus";
      deleteButton.style.cssText = `
        background:#dc2626;
        color:white;
        border:0;
        border-radius:8px;
        padding:9px 14px;
      `;

      deleteButton.addEventListener("click", function () {
        deleteTripHistory(trip.id);
      });

      buttons.append(viewButton, deleteButton);
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
// TAMPILKAN RUTE LAMA DI PETA
// =========================================

async function showTripRoute(id) {
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

    if (startMarker) map.removeLayer(startMarker);
    if (endMarker) map.removeLayer(endMarker);

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
// HAPUS SATU RIWAYAT
// =========================================

async function deleteTripHistory(id) {
  if (!confirm("Hapus riwayat perjalanan ini?")) return;

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
