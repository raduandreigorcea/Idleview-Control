<script setup>
import { ref, onMounted, onBeforeUnmount, watch, nextTick } from 'vue'
import ChoiceInput from './components/ChoiceInput.vue'
import ToggleSwitch from './components/ToggleSwitch.vue'

// Relative URLs: in production the panel is served by the Idleview app itself; in
// development the Vite proxy in vite.config.js forwards /api to the app on port 8737.

// Writes require the control token shown on the Idleview screen. Reads are open, but
// an unpaired panel shows nothing but the pairing prompt.
const TOKEN_KEY = 'idleviewControlToken'
const token = ref(localStorage.getItem(TOKEN_KEY) || '')
const tokenInput = ref('')
const needsToken = ref(false)
const tokenError = ref('')

// Identifies this panel, so it can skip the broadcast of its own change instead of
// reloading in a loop - while still picking up another panel's.
const clientId = (() => {
  const existing = sessionStorage.getItem('idleviewClientId')
  if (existing) return existing
  const fresh = `panel-${Math.random().toString(36).slice(2)}-${Date.now().toString(36)}`
  sessionStorage.setItem('idleviewClientId', fresh)
  return fresh
})()

// The same shape the backend stores, so saving is just sending it back.
const settings = ref(null)

const isLoading = ref(true)
const connectionError = ref(false)
// The bar pinned to the bottom of the screen, so it is seen wherever the page is
// scrolled: { text, kind: 'ok' | 'error' }.
const notice = ref(null)
const photo = ref(null)
const backgroundRef = ref(null)

// The user's own photos: [{ id, thumb }], thumb being a blob URL (the thumbnails need
// the token, so they cannot be plain <img src> URLs).
const library = ref([])
const uploading = ref('')

let applyingServerState = false
let saveTimer = null
let noticeTimer = null
let backgroundBlobUrl = null

const temperatureOptions = [
  { value: 'celsius', label: '°C' },
  { value: 'fahrenheit', label: '°F' }
]
const timeOptions = [
  { value: '24h', label: '14:30' },
  { value: '12h', label: '2:30 PM' }
]
// Shown as examples of what the screen will print, not as DD/MM/YYYY codes.
const dateOptions = [
  { value: 'dmy', label: '26 Apr' },
  { value: 'mdy', label: 'Apr 26' },
  { value: 'ymd', label: '2026 Apr' }
]
const windOptions = [
  { value: 'kmh', label: 'km/h' },
  { value: 'mph', label: 'mph' },
  { value: 'ms', label: 'm/s' }
]
const sourceOptions = [
  { value: 'unsplash', label: 'Unsplash' },
  { value: 'local', label: 'My photos' }
]
const intervalOptions = [
  { value: 15, label: '15 min' },
  { value: 30, label: '30 min' },
  { value: 60, label: '1 h' },
  { value: 120, label: '2 h' }
]

const showToggles = [
  { key: 'show_clock', label: 'Clock' },
  { key: 'show_weekday', label: 'Day of the week' },
  { key: 'show_date', label: 'Date' },
  { key: 'show_location', label: 'Location' },
  { key: 'show_temperature', label: 'Temperature' },
  { key: 'show_sunrise_sunset', label: 'Sunrise and sunset' },
  { key: 'show_precipitation_cloudiness', label: 'Rain and clouds' },
  { key: 'show_humidity_wind', label: 'Humidity and wind' }
]

const notify = (text, kind = 'ok') => {
  notice.value = { text, kind }
  clearTimeout(noticeTimer)
  noticeTimer = setTimeout(() => { notice.value = null }, kind === 'error' ? 6000 : 2500)
}

const loadSettings = async () => {
  try {
    connectionError.value = false
    const response = await fetch('/api/settings')
    if (!response.ok) throw new Error(`Failed to fetch settings: ${response.status}`)

    applyingServerState = true
    settings.value = await response.json()
    // Let the watcher see the new values land before it may fire again, otherwise
    // applying server state would immediately queue a save of that same state.
    await nextTick()
  } catch (error) {
    console.error('Error loading settings:', error)
    connectionError.value = true
  } finally {
    applyingServerState = false
    isLoading.value = false
  }
}

const loadPhoto = async () => {
  try {
    const response = await fetch('/api/photo/current')
    if (!response.ok) return
    const current = await response.json()
    if (!current?.url) {
      photo.value = null
      if (backgroundRef.value) backgroundRef.value.style.backgroundImage = ''
      return
    }

    // One of the user's own photos is served by this server behind the token.
    let url = current.url
    if (url.startsWith('/api/')) {
      if (!token.value) return
      const blob = await (await authedFetch(url)).blob()
      if (backgroundBlobUrl) URL.revokeObjectURL(backgroundBlobUrl)
      url = backgroundBlobUrl = URL.createObjectURL(blob)
    }

    // Preload before swapping, so the background never flashes blank.
    const img = new Image()
    img.onload = () => {
      photo.value = current
      if (backgroundRef.value) backgroundRef.value.style.backgroundImage = `url("${url}")`
    }
    img.src = url
  } catch (error) {
    console.error('Error loading the current photo:', error)
  }
}

// A rejected token sends the user back to pairing rather than showing a vague error.
const authedFetch = async (path, options = {}) => {
  const response = await fetch(path, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      'X-Idleview-Token': token.value,
      'X-Idleview-Client': clientId,
      ...options.headers
    }
  })

  if (response.status === 401) {
    needsToken.value = true
    tokenError.value = 'That token was rejected. Check the one shown on the Idleview screen.'
    throw new Error('unauthorized')
  }
  if (response.status === 413) throw new Error('That photo is too large (30 MB at most).')
  if (!response.ok) {
    // The server explains itself ("not an image", "library is full") - show that.
    const body = await response.json().catch(() => null)
    throw new Error(body?.error || `Request failed: ${response.status}`)
  }
  return response
}

// A successful save means the screen has already redrawn with it: the server wakes the
// screen before it answers.
const saveSettings = async () => {
  try {
    await authedFetch('/api/settings', { method: 'PATCH', body: JSON.stringify(settings.value) })
    notify('Saved · the screen is updated')
  } catch (error) {
    if (error.message === 'unauthorized') return
    console.error('Error saving settings:', error)
    notify("Couldn't save. Is the screen on?", 'error')
  }
}

// Every change saves itself; there is no Save button to forget.
watch(settings, () => {
  if (applyingServerState || !settings.value) return
  clearTimeout(saveTimer)
  saveTimer = setTimeout(saveSettings, 300)
}, { deep: true })

const resetSettings = async () => {
  if (!confirm('Put every setting back to its default?')) return
  try {
    await authedFetch('/api/settings/reset', { method: 'POST' })
    await loadSettings()
    notify('Settings reset · the screen is updated')
  } catch (error) {
    if (error.message !== 'unauthorized') notify("Couldn't reset. Is the screen on?", 'error')
  }
}

// ===== The user's own photos =====

const loadLibrary = async () => {
  if (needsToken.value || !token.value) return
  try {
    const ids = await (await authedFetch('/api/photos')).json()
    // Keep thumbnails already fetched; fetch only new ones, free the removed ones.
    const known = new Map(library.value.map(item => [item.id, item.thumb]))
    const items = await Promise.all(ids.map(async id => {
      if (known.has(id)) return { id, thumb: known.get(id) }
      const blob = await (await authedFetch(`/api/photos/${id}/thumb`)).blob()
      return { id, thumb: URL.createObjectURL(blob) }
    }))
    known.forEach((thumb, id) => { if (!ids.includes(id)) URL.revokeObjectURL(thumb) })
    library.value = items
  } catch (error) {
    if (error.message !== 'unauthorized') console.error('Error loading your photos:', error)
  }
}

// One request per file, so a big batch shows progress and one bad file does not sink
// the rest.
const addPhotos = async (event) => {
  const files = [...event.target.files]
  event.target.value = ''
  let added = 0

  for (const [index, file] of files.entries()) {
    uploading.value = `Adding ${index + 1} of ${files.length}…`
    try {
      await authedFetch('/api/photos', {
        method: 'POST',
        body: file,
        headers: { 'Content-Type': file.type || 'application/octet-stream' }
      })
      added++
    } catch (error) {
      if (error.message === 'unauthorized') break
      notify(`${file.name}: ${error.message}`, 'error')
    }
  }

  uploading.value = ''
  await loadLibrary()
  if (added) notify(added === 1 ? 'Photo added' : `${added} photos added`)
}

const removePhoto = async (id) => {
  if (!confirm('Remove this photo?')) return
  try {
    await authedFetch(`/api/photos/${id}`, { method: 'DELETE' })
    await loadLibrary()
    notify('Photo removed')
  } catch (error) {
    if (error.message !== 'unauthorized') notify("Couldn't remove it. Is the screen on?", 'error')
  }
}

watch(() => settings.value?.photos.source, (source) => {
  if (source === 'local') loadLibrary()
})

const checkToken = async (candidate) => {
  const response = await fetch('/api/auth/check', { headers: { 'X-Idleview-Token': candidate } })
  return response.ok
}

// Check the typed token before storing it, so a typo is caught here and not on the
// next change.
const submitToken = async () => {
  const candidate = tokenInput.value.trim().toUpperCase()
  if (!candidate) return

  try {
    if (!(await checkToken(candidate))) {
      tokenError.value = 'That token was rejected. Check the one shown on the Idleview screen.'
      return
    }
    token.value = candidate
    localStorage.setItem(TOKEN_KEY, candidate)
    tokenInput.value = ''
    tokenError.value = ''
    needsToken.value = false
    await loadSettings()
  } catch (error) {
    console.error('Error verifying token:', error)
    tokenError.value = 'Could not reach Idleview.'
  }
}

const unpair = () => {
  localStorage.removeItem(TOKEN_KEY)
  token.value = ''
  settings.value = null
  needsToken.value = true
  tokenError.value = ''
}

// Pair first, then load: reads are open server-side, so this ordering is what keeps
// settings off an unpaired phone.
const start = async () => {
  isLoading.value = true
  connectionError.value = false
  try {
    if (token.value && (await checkToken(token.value))) {
      needsToken.value = false
      await loadSettings()
      return
    }
    needsToken.value = true
  } catch (error) {
    console.error('Could not reach Idleview:', error)
    connectionError.value = true
  }
  isLoading.value = false
}

let events = null

const listen = () => {
  events = new EventSource('/api/events')
  events.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data)
      if (data.type === 'photo-updated') {
        loadPhoto()
      } else if (data.type === 'photos-updated') {
        loadLibrary()
      } else if (data.type === 'settings-updated' && !needsToken.value && data.origin !== clientId) {
        loadSettings()
      }
    } catch (error) {
      console.error('Bad event from Idleview:', error)
    }
  }
  events.onerror = () => {
    events.close()
    setTimeout(listen, 5000)
  }
}

onMounted(() => {
  start()
  loadPhoto()
  listen()
})

onBeforeUnmount(() => {
  clearTimeout(saveTimer)
  clearTimeout(noticeTimer)
  events?.close()
})
</script>

<template>
  <div class="background" ref="backgroundRef"></div>
  <div class="container">
    <header>
      <h1>Idleview</h1>
    </header>

    <div v-if="isLoading" class="card state">Connecting…</div>

    <div v-else-if="connectionError" class="card state">
      <p class="error">Can't reach the Idleview screen.</p>
      <p>Make sure it is switched on and on the same Wi-Fi as this device.</p>
      <button class="btn btn-primary" @click="start">Try again</button>
    </div>

    <section v-else-if="needsToken" class="card pairing-panel">
      <h2>Pair with your screen</h2>
      <p>
        Type the token shown in the corner of the Idleview screen. It appears for 30
        seconds after the screen starts, or press <strong>T</strong> on its keyboard.
      </p>
      <form class="pairing-form" @submit.prevent="submitToken">
        <input
          v-model="tokenInput"
          class="pairing-input"
          placeholder="e.g. K7PMX2QD"
          autocomplete="off"
          autocapitalize="characters"
          spellcheck="false"
          aria-label="Control token"
        />
        <button type="submit" class="btn btn-primary" :disabled="!tokenInput.trim()">Pair</button>
      </form>
      <p v-if="tokenError" class="error">{{ tokenError }}</p>
    </section>

    <main v-else-if="settings">
      <details class="card" open>
        <summary><h2>Units</h2></summary>
        <ChoiceInput label="Temperature" v-model="settings.units.temperature_unit" :options="temperatureOptions" />
        <ChoiceInput label="Clock" v-model="settings.units.time_format" :options="timeOptions" />
        <ChoiceInput label="Date" v-model="settings.units.date_format" :options="dateOptions" />
        <ChoiceInput label="Wind" v-model="settings.units.wind_speed_unit" :options="windOptions" />
      </details>

      <details class="card" open>
        <summary><h2>Show on screen</h2></summary>
        <ToggleSwitch
          v-for="toggle in showToggles"
          :key="toggle.key"
          :label="toggle.label"
          v-model="settings.display[toggle.key]"
        />
      </details>

      <details class="card" open>
        <summary><h2>Photos</h2></summary>
        <ChoiceInput label="Photos from" v-model="settings.photos.source" :options="sourceOptions" />

        <div v-if="settings.photos.source === 'local'" class="library">
          <p v-if="!library.length" class="hint">
            No photos yet. Until you add some the screen stays dark &mdash; Unsplash is not
            used in this mode.
          </p>
          <div v-else class="grid">
            <figure v-for="item in library" :key="item.id">
              <img :src="item.thumb" alt="" />
              <button type="button" class="remove" aria-label="Remove this photo" @click="removePhoto(item.id)">×</button>
            </figure>
          </div>
          <label class="btn btn-primary add" :class="{ busy: uploading }">
            {{ uploading || 'Add photos' }}
            <input type="file" accept="image/jpeg,image/png,image/webp" multiple hidden
              :disabled="!!uploading" @change="addPhotos" />
          </label>
        </div>

        <ChoiceInput label="New photo every" v-model="settings.photos.refresh_interval" :options="intervalOptions" />
        <ToggleSwitch
          v-if="settings.photos.source !== 'local'"
          label="Holiday photos (Christmas, New Year, Halloween)"
          v-model="settings.photos.enable_festive_queries"
        />
      </details>

      <footer>
        <p v-if="photo?.author" class="credit">
          Photo by <a :href="photo.author_url" target="_blank" rel="noopener">{{ photo.author }}</a> on Unsplash
        </p>
        <div class="footer-actions">
          <button class="btn" @click="resetSettings">Reset to defaults</button>
          <button class="btn" @click="unpair">Unpair this device</button>
        </div>
      </footer>
    </main>
  </div>
  <div class="notice" :class="notice?.kind" role="status" aria-live="polite" v-show="notice">
    {{ notice?.text }}
  </div>
</template>

<style scoped>
.background {
  position: fixed;
  inset: -10%;
  background: #2c3e50 center / cover;
  filter: blur(12px) brightness(0.75);
  z-index: -1;
}

header {
  text-align: center;
  color: white;
  margin-bottom: 1rem;
}

h1 {
  font-size: 2rem;
  margin: 0;
  color: white;
  text-shadow: 0 2px 6px rgba(0, 0, 0, 0.4);
}

.notice {
  position: fixed;
  left: 50%;
  bottom: max(1rem, env(safe-area-inset-bottom));
  transform: translateX(-50%);
  max-width: calc(100vw - 2rem);
  padding: 0.75rem 1.25rem;
  border-radius: 999px;
  background: #1b5e20;
  color: white;
  font-weight: 500;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.3);
  z-index: 10;
}

.notice.error {
  background: #b71c1c;
  border-radius: 12px;
}

.library {
  padding: 0.5rem 0 0.75rem;
  border-bottom: 1px solid #eee;
}

.hint {
  color: #555;
  margin: 0.25rem 0 0.75rem;
}

.grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(88px, 1fr));
  gap: 0.5rem;
  margin-bottom: 0.75rem;
}

.grid figure {
  position: relative;
  margin: 0;
  aspect-ratio: 1;
}

.grid img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  border-radius: 8px;
}

.remove {
  position: absolute;
  top: 4px;
  right: 4px;
  width: 32px;
  height: 32px;
  border: none;
  border-radius: 50%;
  background: rgba(0, 0, 0, 0.6);
  color: white;
  font-size: 1.2rem;
  line-height: 1;
  cursor: pointer;
}

.add {
  width: 100%;
  box-sizing: border-box;
}

.add.busy {
  opacity: 0.7;
  pointer-events: none;
}

.card {
  background: white;
  border-radius: 14px;
  padding: 1rem 1.25rem;
  margin-bottom: 1rem;
  box-shadow: 0 2px 10px rgba(0, 0, 0, 0.15);
}

/* Native open/close: works with keyboard and screen readers, no script needed. */
summary {
  cursor: pointer;
  list-style: none;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0.25rem 0;
}

summary::-webkit-details-marker {
  display: none;
}

summary::after {
  content: '';
  width: 0.55rem;
  height: 0.55rem;
  border-right: 2px solid #90a4ae;
  border-bottom: 2px solid #90a4ae;
  transform: rotate(45deg);
  transition: transform 0.2s;
  margin-right: 0.25rem;
}

details[open] > summary::after {
  transform: rotate(-135deg);
}

summary:focus-visible {
  outline: 2px solid #2196f3;
  outline-offset: 4px;
  border-radius: 4px;
}

summary h2 {
  display: inline;
}

.card h2 {
  font-size: 1.1rem;
  margin: 0.25rem 0 0.25rem;
  color: #2c3e50;
}

.state {
  text-align: center;
  padding: 2rem 1.25rem;
}

.error {
  color: #c62828;
}

.pairing-form {
  display: flex;
  gap: 0.75rem;
  flex-wrap: wrap;
}

.pairing-input {
  flex: 1;
  min-width: 10rem;
  padding: 0.75rem 1rem;
  font-size: 1.2rem;
  font-family: monospace;
  letter-spacing: 0.15em;
  text-transform: uppercase;
  border: 2px solid #ddd;
  border-radius: 10px;
}

.pairing-input:focus {
  outline: none;
  border-color: #2196f3;
}

.pairing-form .btn {
  flex: 0 0 auto;
  min-width: 6rem;
}

.btn:disabled {
  opacity: 0.6;
  cursor: default;
  transform: none;
}

footer {
  border: none;
  margin-top: 1.5rem;
  padding-top: 0;
  color: white;
}

.credit {
  text-shadow: 0 1px 4px rgba(0, 0, 0, 0.5);
}

.credit a {
  color: white;
}

.footer-actions {
  display: flex;
  gap: 0.75rem;
  flex-wrap: wrap;
}

.footer-actions .btn {
  background: rgba(255, 255, 255, 0.9);
  color: #333;
  min-width: 10rem;
}
</style>
