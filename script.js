/**
 * 緯度経度から3次メッシュコードを計算する関数
 * @param {number} lat 緯度
 * @param {number} lng 経度
 * @returns {string} 3次メッシュコード (例: "53393596")
 */
function getMeshCode(lat, lng) {
    // 1次メッシュ
    const r1 = Math.floor(lat * 1.5);
    const c1 = Math.floor(lng - 100);
    const m1 = `${r1}${c1}`;

    // 2次メッシュ
    const lat2 = (lat * 1.5 - r1) * 8;
    const lng2 = (lng - 100 - c1) * 8;
    const r2 = Math.floor(lat2);
    const c2 = Math.floor(lng2);
    const m2 = `${r2}${c2}`;

    // 3次メッシュ
    const lat3 = (lat2 - r2) * 10;
    const lng3 = (lng2 - c2) * 10;
    const r3 = Math.floor(lat3);
    const c3 = Math.floor(lng3);
    const m3 = `${r3}${c3}`;

    return `${m1}${m2}${m3}`;
}

/**
 * 3次メッシュコードからそのメッシュの範囲（四隅の緯度経度）を計算する関数
 * @param {string} code 3次メッシュコード
 * @returns {google.maps.LatLngBoundsLiteral} メッシュの範囲
 */
function getMeshBounds(code) {
    const r1 = parseInt(code.substring(0, 2));
    const c1 = parseInt(code.substring(2, 4));
    const r2 = parseInt(code.substring(4, 5));
    const c2 = parseInt(code.substring(5, 6));
    const r3 = parseInt(code.substring(6, 7));
    const c3 = parseInt(code.substring(7, 8));

    const south = (r1 / 1.5) + (r2 / 12) + (r3 / 120);
    const west = (c1 + 100) + (c2 / 8) + (c3 / 80)
    const lat_km = 1 / 120; // 3次メッシュの緯度方向の高さ
    const lng_km = 1 / 80;  // 3次メッシュの経度方向の幅

    return {
        south: south,
        west: west,
        north: south + lat_km,
        east: west + lng_km
    };
}
    
const firebaseConfig = {
    apiKey: "AIzaSyC6FiX1b0h0QhmzrGbmjKQ_4I1JlkNnmOs",
    authDomain: "maps-464115.firebaseapp.com",
    projectId: "maps-464115",
    storageBucket: "maps-464115.firebasestorage.app",
    messagingSenderId: "172903223749",
    appId: "1:172903223749:web:3fd9b1ae64bda33653fbac",
    measurementId: "G-JXE2F7TM8Y"
}

firebase.initializeApp(firebaseConfig);
const auth = firebase.auth();
const db = firebase.firestore()

let map;
let visitedPlaces = []; // appState
let markers = [];
let meshes = [];
let currentUser = null; // userInformation
let arePinsVisible = true; //ピンの状態

async function initMap() {
    map = new google.maps.Map(document.getElementById("map"), {
        zoom: 12,
        center: { lat: 35.681236, lng: 139.767125 },
        clickableIcons: false
    });

    // identify user
    try {
        const userCredential = await auth.signInAnonymously();
        currentUser = userCredential.user;
        console.log("匿名認証に成功しました。UID:", currentUser.uid);
    } catch (error) {
        console.error("匿名認証に失敗しました:", error);
        alert("ユーザー情報の取得に失敗しました。");
        return;
    }

    // read data from Firestore
    await loadData()
    // 読み込んだデータで地図を初期表示
    updateMap()
    // イベントリスナーを設定
    setupEventListeners();
}
// Firestoreからデータを読み込む
async function loadData() {
    if (!currentUser) return;
    const docRef = db.collection('users').doc(currentUser.uid);
    try {
        const doc = await docRef.get();
        if (doc.exists) {
            // データが存在すれば、visitedPlacesを復元
            visitedPlaces = doc.data().places || [];
            console.log("Firestoreからデータを読み込みました。");
        } else {
            console.log("このユーザーのデータはまだありません。");
            visitedPlaces = [];
        }
    } catch(error) {
        console.error("データの読み込みに失敗しました:", error);
    }
}

// Firestoreにデータを保存する
async function saveData() {
    if (!currentUser) return;
    const docRef = db.collection('users').doc(currentUser.uid);
    try {
        // placesフィールドに、現在のvisitedPlaces配列を丸ごと保存
        await docRef.set({ places: visitedPlaces });
        console.log("Firestoreにデータを保存しました。");
    } catch(error) {
        console.error("データの保存に失敗しました:", error);
    }
}

// ■■■ イベントリスナー設定 ■■■
function setupEventListeners() {
    // 地図クリックで地点追加
    map.addListener('click', (event) => {
        const clickedLatLng = {
            lat: event.latLng.lat(),
            lng: event.latLng.lng()
        };
        visitedPlaces.push(clickedLatLng);
        updateMap();
    });

    const togglePinsCheckbox = document.getElementById('toggle-pins');
    togglePinsCheckbox.addEventListener('change', (event) => {
        // 状態変数をチェックボックスの状態に合わせる
        arePinsVisible = event.target.checked;
        // 地図を再描画
        updateMap();
    });
}

// ■■■ 描画・計算のメイン関数 ■■■
function updateMap() {
    // 古い描画をクリア
    markers.forEach(marker => marker.setMap(null));
    meshes.forEach(mesh => mesh.setMap(null));
    markers = [];
    meshes = [];

    // マーカー再描画（クリックで削除機能付き, 表示状態だけ）
    if (arePinsVisible){
        visitedPlaces.forEach((place, index) => {
            const marker = new google.maps.Marker({ position: place, map: map });
            marker.addListener('click', () => {
                visitedPlaces.splice(index, 1);
                updateMap();
            });
            markers.push(marker);
        });
    }

    // メッシュとスコアを再計算・再描画
    const meshCounts = {};
    visitedPlaces.forEach(place => {
        const meshCode = getMeshCode(place.lat, place.lng);
        meshCounts[meshCode] = (meshCounts[meshCode] || 0) + 1;
    });

    let totalScore = 0;
    const meshCodes = Object.keys(meshCounts);
    meshCodes.forEach(code => {
        const n = meshCounts[code];
        totalScore += 1 - Math.pow(2, -n);
        const bounds = getMeshBounds(code);
        let color = n === 1 ? '#4285F4' : n === 2 ? '#34A853' : n === 3 ? '#FBBC05' : '#EA4335';
        const mesh = new google.maps.Rectangle({
            fillColor: color, fillOpacity: 0.4, strokeWeight: 0,
            map: map, bounds: bounds, clickable: false
        });
        meshes.push(mesh);
    });

    // UI表示を更新
    document.getElementById('total-score').innerText = totalScore.toFixed(4);
    document.getElementById('mesh-count').innerText = meshCodes.length;
    document.getElementById('point-count').innerText = visitedPlaces.length;

    // ★★★ 変更があるたびにデータを保存 ★★★
    saveData();
}
