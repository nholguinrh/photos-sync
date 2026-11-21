const GOOGLE_CLIENT_ID = "198097041766-ej9flj7u9jmnohqrnnepdqfpdldrmkei.apps.googleusercontent.com";
const LOGIN_SCOPE = "openid email profile";
const PICKER_SCOPE =
  "https://www.googleapis.com/auth/photospicker.mediaitems.readonly";
const TOKEN_KEY = "simon_token";
const USER_KEY = "simon_user";
const PHOTOS_KEY = "simon_photos";
const LOGIN_PAGE = "login.html";
const HOME_PAGE = "index.html";
const PHOTOS_MAX_AGE = 50 * 60 * 1000;
const PAGE_INFO = [
  { file: "index.html", label: "Home" },
  { file: "canada.html", label: "Memories of Canada" },
  { file: "colombia.html", label: "Memories of Colombia" },
  { file: "trips.html", label: "Trips & Adventures" },
  { file: "simon-family.html", label: "Family of Simon" },
  { file: "family.html", label: "Our General Family" },
  { file: "gallery.html", label: "Photo Gallery" },
  { file: "story.html", label: "Her Story" },
];

function isLoginPage() {
  return location.pathname.endsWith(LOGIN_PAGE);
}

function environmentProblem() {
  if (location.protocol === "file:") {
    return "Abre el sitio con un servidor local: python3 -m http.server 8000 y entra a http://localhost:8000/login.html";
  }
  if (window.self !== window.top) {
    return "Abre el sitio en una pestaña normal de Chrome, no dentro de la vista previa de un editor.";
  }
  if (location.hostname === "127.0.0.1") {
    return "Google requiere localhost, no 127.0.0.1. Usa la dirección de localhost:";
  }
  return "";
}

function suggestedUrl() {
  if (location.protocol === "file:") {
    return "http://localhost:8000/login.html";
  }
  if (location.hostname === "127.0.0.1") {
    return "http://localhost:" + location.port + location.pathname + location.search;
  }
  return location.href;
}

function isConfigured() {
  return (
    /\.apps\.googleusercontent\.com$/.test(GOOGLE_CLIENT_ID) &&
    !GOOGLE_CLIENT_ID.startsWith("PON_")
  );
}

function readSession() {
  try {
    const raw = sessionStorage.getItem(TOKEN_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw);
    if (!data.token || !data.exp || Date.now() >= data.exp) return null;
    return data;
  } catch (error) {
    return null;
  }
}

function isLoggedIn() {
  return Boolean(readSession());
}

function readUser() {
  try {
    return JSON.parse(localStorage.getItem(USER_KEY) || "null");
  } catch (error) {
    return null;
  }
}

function saveSession(token, expiresIn, user, picker) {
  const previous = readSession();
  const lifetime = Math.max(60, (Number(expiresIn) || 3600) - 60);
  const nextPicker =
    picker === undefined ? Boolean(previous && previous.picker) : Boolean(picker);
  sessionStorage.setItem(
    TOKEN_KEY,
    JSON.stringify({
      token,
      exp: Date.now() + lifetime * 1000,
      picker: nextPicker,
    })
  );
  if (user) {
    localStorage.setItem(USER_KEY, JSON.stringify(user));
  }
}

function clearSession() {
  sessionStorage.removeItem(TOKEN_KEY);
  sessionStorage.removeItem(PHOTOS_KEY);
  localStorage.removeItem(USER_KEY);
}

let gisPromise = null;

function loadGis() {
  if (window.google && window.google.accounts && window.google.accounts.oauth2) {
    return Promise.resolve();
  }
  if (gisPromise) return gisPromise;
  gisPromise = new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = "https://accounts.google.com/gsi/client";
    script.async = true;
    script.defer = true;
    script.onload = () => resolve();
    script.onerror = () =>
      reject(new Error("No se pudo cargar Google Identity Services."));
    document.head.appendChild(script);
  });
  return gisPromise;
}

async function fetchUserInfo(token) {
  const response = await fetch("https://www.googleapis.com/oauth2/v3/userinfo", {
    headers: { Authorization: "Bearer " + token },
  });
  if (!response.ok) {
    throw new Error("No se pudo obtener el perfil de Google.");
  }
  return response.json();
}

function requestToken(scope, picker) {
  return new Promise((resolve, reject) => {
    const client = google.accounts.oauth2.initTokenClient({
      client_id: GOOGLE_CLIENT_ID,
      scope,
      ux_mode: "popup",
      callback: async (response) => {
        if (response.error) {
          reject(new Error(response.error));
          return;
        }
        try {
          const user = await fetchUserInfo(response.access_token);
          saveSession(response.access_token, response.expires_in, user, picker);
          resolve(response.access_token);
        } catch (error) {
          reject(error);
        }
      },
      error_callback: (error) =>
        reject(new Error((error && error.type) || "google_auth_error")),
    });
    client.requestAccessToken({ prompt: "" });
  });
}

async function signIn() {
  if (!isConfigured()) {
    throw new Error("Falta configurar el Client ID de Google en auth.js.");
  }
  await loadGis();
  return requestToken(LOGIN_SCOPE, false);
}

async function authorizePicker() {
  if (!isConfigured()) {
    throw new Error("Falta configurar el Client ID de Google en auth.js.");
  }
  await loadGis();
  return requestToken(LOGIN_SCOPE + " " + PICKER_SCOPE, true);
}

async function ensurePickerToken() {
  const session = readSession();
  if (session && session.picker) return session.token;
  return authorizePicker();
}

function signOut() {
  const session = readSession();
  if (session && window.google && window.google.accounts && window.google.accounts.oauth2) {
    try {
      google.accounts.oauth2.revoke(session.token, () => {});
    } catch (error) {}
  }
  clearSession();
  location.replace(LOGIN_PAGE);
}

function readStoredPhotos() {
  try {
    const data = JSON.parse(sessionStorage.getItem(PHOTOS_KEY) || "null");
    if (!data || !Array.isArray(data.items) || !data.at) return [];
    if (Date.now() - data.at > PHOTOS_MAX_AGE) {
      sessionStorage.removeItem(PHOTOS_KEY);
      return [];
    }
    return data.items;
  } catch (error) {
    return [];
  }
}

function saveStoredPhotos(items) {
  sessionStorage.setItem(
    PHOTOS_KEY,
    JSON.stringify({ at: Date.now(), items })
  );
}

function currentPageFile() {
  const file = location.pathname.split("/").pop() || HOME_PAGE;
  return PAGE_INFO.some((page) => page.file === file) ? file : HOME_PAGE;
}

function photosForPage(items) {
  const file = currentPageFile();
  return items.filter((item) => item.page === file);
}

function mergePhotos(existing, incoming) {
  const byId = new Map();
  existing.forEach((item) => {
    byId.set(item.id || item.baseUrl, { ...item });
  });
  incoming.forEach((item) => {
    const key = item.id || item.baseUrl;
    const previous = byId.get(key) || {};
    byId.set(key, {
      ...previous,
      ...item,
      page: item.page || previous.page || "",
    });
  });
  return Array.from(byId.values());
}

function durationToMs(value, fallback) {
  const seconds = parseFloat(value);
  return Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : fallback;
}

async function createPickerSession(token) {
  const response = await fetch("https://photospicker.googleapis.com/v1/sessions", {
    method: "POST",
    headers: {
      Authorization: "Bearer " + token,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ pickingConfig: { maxItemCount: "60" } }),
  });
  if (!response.ok) {
    throw new Error(
      "No se pudo abrir el selector de Google Photos (" + response.status + ")."
    );
  }
  return response.json();
}

async function getPickerSession(sessionId) {
  const session = readSession();
  const response = await fetch(
    "https://photospicker.googleapis.com/v1/sessions/" + encodeURIComponent(sessionId),
    { headers: { Authorization: "Bearer " + session.token } }
  );
  if (!response.ok) {
    throw new Error(
      "No se pudo consultar la sesión de Google Photos (" + response.status + ")."
    );
  }
  return response.json();
}

async function pollPickerSession(pickerSession) {
  const interval = Math.max(
    1500,
    durationToMs(pickerSession.pollingConfig && pickerSession.pollingConfig.pollInterval, 3000)
  );
  const timeout = Math.max(
    30000,
    durationToMs(pickerSession.pollingConfig && pickerSession.pollingConfig.timeoutIn, 180000)
  );
  const started = Date.now();
  while (Date.now() - started < timeout) {
    await new Promise((resolve) => setTimeout(resolve, interval));
    const current = await getPickerSession(pickerSession.id);
    if (current.mediaItemsSet) return current;
  }
  throw new Error("Se agotó el tiempo esperando tu selección de fotos.");
}

async function listPickedItems(sessionId) {
  const session = readSession();
  const items = [];
  let pageToken = "";
  for (let page = 0; page < 5; page++) {
    const params = new URLSearchParams({ sessionId, pageSize: "100" });
    if (pageToken) params.set("pageToken", pageToken);
    const response = await fetch(
      "https://photospicker.googleapis.com/v1/mediaItems?" + params.toString(),
      { headers: { Authorization: "Bearer " + session.token } }
    );
    if (!response.ok) {
      throw new Error(
        "No se pudieron leer las fotos seleccionadas (" + response.status + ")."
      );
    }
    const data = await response.json();
    (data.mediaItems || []).forEach((item) => {
      if (item.type !== "PHOTO" || !item.mediaFile || !item.mediaFile.baseUrl) {
        return;
      }
      items.push({
        id: item.id,
        baseUrl: item.mediaFile.baseUrl,
        filename: item.mediaFile.filename || "",
      });
    });
    if (!data.nextPageToken) break;
    pageToken = data.nextPageToken;
  }
  return items;
}

async function pickPhotos() {
  const popup = window.open("", "google_photos_picker");
  try {
    const token = await ensurePickerToken();
    const pickerSession = await createPickerSession(token);
    const pickerUrl = pickerSession.pickerUri.replace(/\/$/, "") + "/autoclose";
    if (popup && !popup.closed) {
      popup.location.href = pickerUrl;
    } else {
      window.open(pickerUrl, "_blank");
    }
    await pollPickerSession(pickerSession);
    const items = await listPickedItems(pickerSession.id);
    if (popup && !popup.closed) popup.close();
    return items;
  } catch (error) {
    if (popup && !popup.closed) popup.close();
    throw error;
  }
}

const objectUrls = [];

async function photoBlobUrl(item, width, height) {
  const session = readSession();
  if (!session) throw new Error("Sesión expirada.");
  const response = await fetch(item.baseUrl + "=w" + width + "-h" + height, {
    headers: { Authorization: "Bearer " + session.token },
  });
  if (!response.ok) {
    throw new Error("No se pudo cargar una foto (" + response.status + ").");
  }
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  objectUrls.push(url);
  return url;
}

window.addEventListener("pagehide", () => {
  objectUrls.forEach((url) => URL.revokeObjectURL(url));
});

async function renderPhotoCard(item, width, height) {
  const image = document.createElement("img");
  image.alt = item.filename || "Foto de Google Photos";
  image.loading = "lazy";
  try {
    image.src = await photoBlobUrl(item, width, height);
  } catch (error) {
    image.alt = "No se pudo cargar la foto";
  }
  return image;
}

function mountUserChip() {
  if (isLoginPage()) return;
  const header = document.querySelector("header");
  if (!header || document.querySelector(".user-chip")) return;
  const user = readUser();
  const chip = document.createElement("div");
  chip.className = "user-chip";
  if (user) {
    if (user.picture) {
      const avatar = document.createElement("img");
      avatar.src = user.picture;
      avatar.alt = user.name || "Usuario";
      avatar.referrerPolicy = "no-referrer";
      chip.appendChild(avatar);
    }
    const name = document.createElement("span");
    name.className = "user-name";
    name.textContent = user.name || user.email || "Sesión de Google";
    chip.appendChild(name);
    const button = document.createElement("button");
    button.type = "button";
    button.className = "sign-out";
    button.textContent = "Salir";
    button.addEventListener("click", signOut);
    chip.appendChild(button);
  } else {
    const link = document.createElement("a");
    link.href = LOGIN_PAGE;
    link.textContent = "Iniciar sesión";
    chip.appendChild(link);
  }
  header.appendChild(chip);
}

function ensurePhotoSection() {
  if (isLoginPage()) return null;
  const existing = document.querySelector("#google-photos-grid");
  if (existing) return existing;
  if (document.querySelector(".photo-grid")) return null;
  const main = document.querySelector("main");
  if (!main) return null;
  const section = document.createElement("section");
  section.className = "photo-sync";
  const title = document.createElement("h2");
  title.textContent = "Google Photos";
  const text = document.createElement("p");
  text.textContent = "Fotos seleccionadas desde tu cuenta de Google.";
  const grid = document.createElement("div");
  grid.className = "photo-grid";
  grid.id = "google-photos-grid";
  section.appendChild(title);
  section.appendChild(text);
  section.appendChild(grid);
  main.appendChild(section);
  return grid;
}

function showGridMessage(grid, text, isError) {
  grid.textContent = "";
  const message = document.createElement("p");
  message.className = isError ? "photos-error" : "section-note";
  message.textContent = text;
  grid.appendChild(message);
}

function appendPageOptions(select, includeEmpty) {
  if (includeEmpty) {
    const empty = document.createElement("option");
    empty.value = "";
    empty.textContent = "Sin asignar";
    select.appendChild(empty);
  }
  PAGE_INFO.forEach((page) => {
    const option = document.createElement("option");
    option.value = page.file;
    option.textContent = page.label;
    select.appendChild(option);
  });
}

async function fillCategorizeThumb(image, item) {
  try {
    image.src = await photoBlobUrl(item, 320, 320);
  } catch (error) {
    image.alt = "No se pudo cargar la foto";
  }
}

function openCategorizeDialog(items, onSave) {
  const dialog = document.createElement("dialog");
  dialog.className = "categorize-dialog";

  const panel = document.createElement("div");
  panel.className = "categorize-panel";

  const title = document.createElement("h2");
  title.textContent = "Categorizar fotos";

  const text = document.createElement("p");
  text.textContent =
    "Asigna cada foto a la página del menú donde quieres verla. Las fotos sin asignar no se muestran.";

  const selects = new Map();

  const bulk = document.createElement("div");
  bulk.className = "categorize-bulk";
  const bulkLabel = document.createElement("label");
  bulkLabel.textContent = "Asignar todas a:";
  const bulkSelect = document.createElement("select");
  appendPageOptions(bulkSelect, true);
  const bulkButton = document.createElement("button");
  bulkButton.type = "button";
  bulkButton.className = "categorize-bulk-apply";
  bulkButton.textContent = "Aplicar";
  bulkButton.addEventListener("click", () => {
    selects.forEach((select) => {
      select.value = bulkSelect.value;
    });
  });
  bulkLabel.appendChild(bulkSelect);
  bulk.append(bulkLabel, bulkButton);

  const grid = document.createElement("div");
  grid.className = "categorize-grid";

  items.forEach((item) => {
    const card = document.createElement("div");
    card.className = "categorize-item";

    const image = document.createElement("img");
    image.alt = item.filename || "Foto de Google Photos";
    image.loading = "lazy";
    fillCategorizeThumb(image, item);

    const name = document.createElement("span");
    name.className = "categorize-name";
    name.textContent = item.filename || "Foto";

    const select = document.createElement("select");
    select.setAttribute("aria-label", "Página para " + (item.filename || "la foto"));
    appendPageOptions(select, true);
    select.value = item.page || "";
    selects.set(item.id || item.baseUrl, select);

    card.append(image, name, select);
    grid.appendChild(card);
  });

  const actions = document.createElement("div");
  actions.className = "categorize-actions";

  const cancel = document.createElement("button");
  cancel.type = "button";
  cancel.className = "categorize-cancel";
  cancel.textContent = "Cancelar";
  cancel.addEventListener("click", () => dialog.close());

  const save = document.createElement("button");
  save.type = "button";
  save.className = "categorize-save";
  save.textContent = "Guardar categorías";
  save.addEventListener("click", () => {
    const updated = items.map((item) => {
      const select = selects.get(item.id || item.baseUrl);
      return { ...item, page: select ? select.value : item.page || "" };
    });
    onSave(updated);
    dialog.close();
  });

  actions.append(cancel, save);
  panel.append(title, text, bulk, grid, actions);
  dialog.appendChild(panel);
  document.body.appendChild(dialog);
  dialog.addEventListener("close", () => dialog.remove());
  dialog.showModal();
}

async function fillPhotoGrid(grid, items, skip) {
  grid.textContent = "";
  const start = Number(skip) || 0;
  const arranged = start
    ? items.slice(start).concat(items.slice(0, start))
    : items;
  const cards = await Promise.all(
    arranged.slice(0, 12).map(async (item) => {
      const card = document.createElement("figure");
      card.className = "photo-card";
      card.appendChild(await renderPhotoCard(item, 800, 800));
      const caption = document.createElement("figcaption");
      caption.textContent = item.filename || "";
      card.appendChild(caption);
      return card;
    })
  );
  cards.forEach((card) => grid.appendChild(card));
}

async function fillPlaceholders(items) {
  const slots = Array.from(document.querySelectorAll(".photo-placeholder"));
  if (!slots.length || !items.length) return;
  await Promise.all(
    slots.map(async (slot, index) => {
      const item = items[index % items.length];
      const image = await renderPhotoCard(item, 900, 700);
      slot.classList.add("has-photo");
      slot.textContent = "";
      slot.appendChild(image);
    })
  );
}

async function loadPhotos() {
  if (isLoginPage() || !isLoggedIn()) return;
  const grid = ensurePhotoSection();
  const placeholders = document.querySelectorAll(".photo-placeholder");
  if (!grid && !placeholders.length) return;
  const stored = readStoredPhotos();
  if (!stored.length) {
    if (grid) {
      showGridMessage(
        grid,
        "Aún no hay fotos seleccionadas. Usa el botón para elegir fotos de Google Photos.",
        false
      );
    }
    return;
  }
  const items = photosForPage(stored);
  if (!items.length) {
    if (grid) {
      showGridMessage(
        grid,
        "No hay fotos asignadas a esta página. Categorízalas desde Inicio.",
        false
      );
    }
    return;
  }
  try {
    if (grid) await fillPhotoGrid(grid, items, placeholders.length);
    await fillPlaceholders(items);
  } catch (error) {
    if (grid) {
      showGridMessage(
        grid,
        "No se pudieron cargar las fotos: " + (error.message || "error desconocido"),
        true
      );
    }
    console.error("Google Photos:", error);
  }
}

function setSyncStatus(text, isError) {
  const status = document.querySelector("#sync-status");
  if (!status) return;
  status.textContent = text;
  status.classList.toggle("is-error", Boolean(isError));
}

function wireSyncButton() {
  const button = document.querySelector("#sync-photos");
  if (!button) return;
  button.addEventListener("click", async () => {
    if (button.disabled) return;
    button.disabled = true;
    button.textContent = "Abriendo Google Photos...";
    setSyncStatus("", false);
    try {
      const picked = await pickPhotos();
      if (!picked.length) {
        setSyncStatus("No seleccionaste fotos.", false);
        return;
      }
      const merged = mergePhotos(readStoredPhotos(), picked);
      setSyncStatus(
        "Seleccionaste " +
          picked.length +
          " foto" +
          (picked.length === 1 ? "" : "s") +
          ". Asígnalas a una página.",
        false
      );
      openCategorizeDialog(merged, (categorized) => {
        saveStoredPhotos(categorized);
        setSyncStatus("Categorías guardadas.", false);
        loadPhotos();
      });
    } catch (error) {
      setSyncStatus(
        "No se pudo sincronizar: " + (error.message || "error desconocido"),
        true
      );
    } finally {
      button.disabled = false;
      button.textContent = "Sincronizar con Google Photos";
    }
  });
}

function wireCategorizeButton() {
  const button = document.querySelector("#categorize-photos");
  if (!button) return;
  button.addEventListener("click", () => {
    const items = readStoredPhotos();
    if (!items.length) {
      setSyncStatus("Primero sincroniza fotos desde Google Photos.", true);
      return;
    }
    openCategorizeDialog(items, (categorized) => {
      saveStoredPhotos(categorized);
      setSyncStatus("Categorías guardadas.", false);
      loadPhotos();
    });
  });
}

function init() {
  mountUserChip();
  wireSyncButton();
  wireCategorizeButton();
  loadPhotos();
  if (document.querySelector("#sync-photos")) {
    loadGis().catch(() => {});
  }
}

if (!isLoginPage() && !isLoggedIn()) {
  location.replace(LOGIN_PAGE);
}

document.addEventListener("DOMContentLoaded", init);

window.SimonAuth = {
  signIn,
  signOut,
  isConfigured,
  isLoggedIn,
  readUser,
  pickPhotos,
  loadPhotos,
  environmentProblem,
  suggestedUrl,
  HOME_PAGE,
};
