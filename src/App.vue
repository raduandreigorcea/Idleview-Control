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
const status = ref('') // '', 'saving', 'saved', 'error'
const photo = ref(null)
const backgroundRef = ref(null)
const isRefreshingPhoto = ref(false)

let applyingServerState = false
let saveTimer = null
let statusTimer = null

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

const flashStatus = (value) => {
  status.value = value
  clearTimeout(statusTimer)
  if (value === 'saved') statusTimer = setTimeout(() => { status.value = '' }, 2000)
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
    if (!current?.url) return

    // Preload before swapping, so the background never flashes blank.
    const img = new Image()
    img.onload = () => {
      photo.value = current
      if (backgroundRef.value) backgroundRef.value.style.backgroundImage = `url("${current.url}")`
    }
    img.src = current.url
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
      'X-Idleview-Client': clientId
    }
  })

  if (response.status === 401) {
    needsToken.value = true
    tokenError.value = 'That token was rejected. Check the one shown on the Idleview screen.'
    throw new Error('unauthorized')
  }
  if (!response.ok) throw new Error(`Request failed: ${response.status}`)
  return response
}

const saveSettings = async () => {
  flashStatus('saving')
  try {
    await authedFetch('/api/settings', { method: 'PATCH', body: JSON.stringify(settings.value) })
    flashStatus('saved')
  } catch (error) {
    if (error.message === 'unauthorized') return flashStatus('')
    console.error('Error saving settings:', error)
    flashStatus('error')
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
    flashStatus('saved')
  } catch (error) {
    if (error.message !== 'unauthorized') flashStatus('error')
  }
}

const refreshPhoto = async () => {
  isRefreshingPhoto.value = true
  try {
    await authedFetch('/api/photo/refresh', { method: 'POST' })
  } catch (error) {
    if (error.message !== 'unauthorized') flashStatus('error')
  } finally {
    // The new photo arrives over SSE once the screen has it.
    setTimeout(() => { isRefreshingPhoto.value = false }, 1500)
  }
}

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
  clearTimeout(statusTimer)
  events?.close()
})
</script>

<template>
  <div class="background" ref="backgroundRef"></div>
  <div class="container">
    <header>
      <h1>Idleview</h1>
      <p class="status" :class="status" aria-live="polite">
        <template v-if="status === 'saving'">Saving…</template>
        <template v-else-if="status === 'saved'">Saved ✓</template>
        <template v-else-if="status === 'error'">Couldn't save. Is the screen on?</template>
      </p>
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
      <section class="card">
        <h2>Units</h2>
        <ChoiceInput label="Temperature" v-model="settings.units.temperature_unit" :options="temperatureOptions" />
        <ChoiceInput label="Clock" v-model="settings.units.time_format" :options="timeOptions" />
        <ChoiceInput label="Date" v-model="settings.units.date_format" :options="dateOptions" />
        <ChoiceInput label="Wind" v-model="settings.units.wind_speed_unit" :options="windOptions" />
      </section>

      <section class="card">
        <h2>Show on screen</h2>
        <ToggleSwitch
          v-for="toggle in showToggles"
          :key="toggle.key"
          :label="toggle.label"
          v-model="settings.display[toggle.key]"
        />
      </section>

      <section class="card">
        <h2>Photos</h2>
        <ChoiceInput label="New photo every" v-model="settings.photos.refresh_interval" :options="intervalOptions" />
        <ToggleSwitch label="Holiday photos (Christmas, New Year, Halloween)" v-model="settings.photos.enable_festive_queries" />
        <button class="btn btn-primary wide" @click="refreshPhoto" :disabled="isRefreshingPhoto">
          {{ isRefreshingPhoto ? 'Asking the screen…' : 'New photo now' }}
        </button>
      </section>

      <footer>
        <p v-if="photo" class="credit">
          Photo by <a :href="photo.author_url" target="_blank" rel="noopener">{{ photo.author }}</a> on Unsplash
        </p>
        <div class="footer-actions">
          <button class="btn" @click="resetSettings">Reset to defaults</button>
          <button class="btn" @click="unpair">Unpair this device</button>
        </div>
      </footer>
    </main>
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

.status {
  min-height: 1.4em;
  margin: 0.25rem 0 0;
  font-size: 0.95rem;
  text-shadow: 0 1px 4px rgba(0, 0, 0, 0.5);
}

.status.error {
  color: #ffcdd2;
}

.card {
  background: white;
  border-radius: 14px;
  padding: 1rem 1.25rem;
  margin-bottom: 1rem;
  box-shadow: 0 2px 10px rgba(0, 0, 0, 0.15);
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

.wide {
  width: 100%;
  margin: 0.75rem 0 0.25rem;
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
