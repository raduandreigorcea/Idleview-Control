<script setup>
import { ref, computed, onMounted, onBeforeUnmount, watch, nextTick } from 'vue'
import SelectInput from './components/SelectInput.vue'
import ToggleSwitch from './components/ToggleSwitch.vue'
import FontPicker from './components/FontPicker.vue'
import ScreenPreview from './components/ScreenPreview.vue'
import RulerIcon from './assets/ruler-dimension-line.svg'
import MonitorIcon from './assets/monitor-cog.svg'
import ImageIcon from './assets/image.svg'
import SettingsIcon from './assets/settings.svg'
import ResetIcon from './assets/book-marked.svg'
import BracesIcon from './assets/braces.svg'
import TypeIcon from './assets/type-outline.svg'
import RefreshIcon from './assets/refresh-ccw.svg'


// Relative URLs throughout. In production the panel is served by the Idleview app
// itself, so it is already same-origin; in development the Vite proxy in
// vite.config.js forwards /api to the app on port 8737.
const API_BASE = ''

// Writes require the control token shown on the Idleview screen (press T there).
// Reads are open, so the panel can render before it is paired.
const TOKEN_KEY = 'idleviewControlToken'
const token = ref(localStorage.getItem(TOKEN_KEY) || '')
const tokenInput = ref('')
const needsToken = ref(false)
const tokenError = ref('')

// Identifies this panel so the server can label the broadcast it triggers, letting us
// skip our own echo. The old code muted ALL settings events for a second after any
// save, which silently dropped a second panel's legitimate change if it landed inside
// that window.
const clientId = (() => {
  const existing = sessionStorage.getItem('idleviewClientId')
  if (existing) return existing
  const fresh = `panel-${Math.random().toString(36).slice(2)}-${Date.now().toString(36)}`
  sessionStorage.setItem('idleviewClientId', fresh)
  return fresh
})()

const authHeaders = () => ({
  'Content-Type': 'application/json',
  'X-Idleview-Token': token.value,
  'X-Idleview-Client': clientId
})

const settings = ref({
  tempUnit: 'celsius',
  timeFormat: '24h',
  dateFormat: 'dmy',
  windUnit: 'kmh',
  clockFont: 'roboto',
  clockFontWeight: '400',
  clockFontSize: 180,
  weekdayFont: 'great_vibes',
  weekdayFontWeight: '400',
  weekdayFontSize: 70,
  dateFont: 'kaushan_script',
  dateFontWeight: '400',
  dateFontSize: 40,
  showClock: true,
  showDate: true,
  showWeekday: true,
  showTemperature: true,
  showHumidityWind: true,
  showPrecipitation: true,
  showSunriseSunset: true,
  showLocation: true,
  showDebug: false,
  festivePhotos: true,
  photoInterval: '30',
  photoQuality: '80'
})

const messages = ref([])
const isLoading = ref(true)
const connectionError = ref(false)
const backgroundPhoto = ref('')
const bgImageRef = ref(null)
const photoCredits = ref(null)
const customQuery = ref('')

const isRefreshingPhoto = ref(false)

let messageIdCounter = 0
let isApplyingServerState = false
let saveDebounceTimer = null

// Track expanded sections - load from localStorage or default to collapsed
const loadExpandedSections = () => {
  const defaults = { units: false, display: false, fonts: false, clockFonts: false, weekdayFonts: false, dateFonts: false, photos: false, dev: false }
  const stored = localStorage.getItem('expandedSections')
  if (stored) {
    try {
      return { ...defaults, ...JSON.parse(stored) }
    } catch (e) {
      console.error('Error parsing stored sections:', e)
    }
  }
  return defaults
}

const expandedSections = ref(loadExpandedSections())

const toggleSection = (section) => {
  expandedSections.value[section] = !expandedSections.value[section]
  // Persist to localStorage
  localStorage.setItem('expandedSections', JSON.stringify(expandedSections.value))
}

// Keyboard handler for collapsible headers
const handleHeaderKeydown = (event, section) => {
  if (event.key === 'Enter' || event.key === ' ') {
    event.preventDefault()
    toggleSection(section)
  }
}

// Helper to show notification
const showMessage = (text, type = 'success') => {
  const id = messageIdCounter++
  messages.value.unshift({ id, text, type })
  setTimeout(() => {
    messages.value = messages.value.filter(m => m.id !== id)
  }, 5000)
}

// Options for selects
const tempOptions = [
  { value: 'celsius', label: 'Celsius (°C)' },
  { value: 'fahrenheit', label: 'Fahrenheit (°F)' }
]

const timeOptions = [
  { value: '24h', label: '24-hour' },
  { value: '12h', label: '12-hour (AM/PM)' }
]

const dateOptions = [
  { value: 'dmy', label: 'DD/MM/YYYY' },
  { value: 'mdy', label: 'MM/DD/YYYY' },
  { value: 'ymd', label: 'YYYY/MM/DD' }
]

const windOptions = [
  { value: 'kmh', label: 'km/h' },
  { value: 'mph', label: 'mph' },
  { value: 'ms', label: 'm/s' }
]

// ===== Fonts =====
//
// The catalogue comes from the backend (GET /api/fonts). This file used to carry its
// own font lists, CSS stacks and weight names, and so did the dashboard, and so did two
// hand-written Google Fonts <link> tags. They disagreed: "Google Sans" was offered and
// is not on Google Fonts at all, "Space Grotesk" was a fallback nobody loaded, and every
// font offered "Thin" (200) including Arimo, which publishes nothing below 400.
//
// Now there is one list, the stylesheet is generated from it, and the weights on offer
// are the ones the chosen font actually has.
const fontCatalogue = ref(null)

const fontsFor = (role) => {
  const catalogue = fontCatalogue.value
  if (!catalogue?.fonts || !Array.isArray(catalogue[role])) return []
  return catalogue[role].map(id => catalogue.fonts.find(font => font.id === id)).filter(Boolean)
}

const clockFonts = computed(() => fontsFor('clock'))
const weekdayFonts = computed(() => fontsFor('weekday'))
const dateFonts = computed(() => fontsFor('date'))

const WEIGHT_LABELS = {
  100: 'Thin',
  200: 'Extra Light',
  300: 'Light',
  400: 'Regular',
  500: 'Medium',
  600: 'Semi Bold',
  700: 'Bold',
  800: 'Extra Bold',
  900: 'Black'
}

// Only the weights the selected font really ships. A face with a single weight (most of
// the script fonts) collapses to one option instead of pretending to offer six.
const weightOptionsFor = (fontId) => {
  const font = fontCatalogue.value?.fonts.find(f => f.id === fontId)
  if (!font) return []
  return font.weights.map(weight => ({
    value: String(weight),
    label: `${WEIGHT_LABELS[weight] || weight} (${weight})`
  }))
}

const clockWeightOptions = computed(() => weightOptionsFor(settings.value.clockFont))
const weekdayWeightOptions = computed(() => weightOptionsFor(settings.value.weekdayFont))
const dateWeightOptions = computed(() => weightOptionsFor(settings.value.dateFont))

// Changing font can strand a weight the new face does not have. The backend would snap
// it anyway, but doing it here keeps the control showing what will actually be saved.
const snapWeight = (fontId, current) => {
  const font = fontCatalogue.value?.fonts.find(f => f.id === fontId)
  if (!font || font.weights.includes(Number(current))) return String(current)
  const nearest = font.weights.reduce((best, weight) =>
    Math.abs(weight - Number(current)) < Math.abs(best - Number(current)) ? weight : best
  )
  return String(nearest)
}

watch(() => settings.value.clockFont, (id) => {
  settings.value.clockFontWeight = snapWeight(id, settings.value.clockFontWeight)
})
watch(() => settings.value.weekdayFont, (id) => {
  settings.value.weekdayFontWeight = snapWeight(id, settings.value.weekdayFontWeight)
})
watch(() => settings.value.dateFont, (id) => {
  settings.value.dateFontWeight = snapWeight(id, settings.value.dateFontWeight)
})

// Size bounds also come from the backend, so the panel, the screen and the validator
// cannot disagree about them the way they used to (the dashboard capped the weekday and
// date sizes at 120 while this panel happily accepted 200).
const CLOCK_FONT_SIZE_MIN = computed(() => fontCatalogue.value?.clock_size[0] ?? 120)
const CLOCK_FONT_SIZE_MAX = computed(() => fontCatalogue.value?.clock_size[1] ?? 260)
const SECONDARY_FONT_SIZE_MIN = computed(() => fontCatalogue.value?.secondary_size[0] ?? 40)
const SECONDARY_FONT_SIZE_MAX = computed(() => fontCatalogue.value?.secondary_size[1] ?? 200)

const loadFontCatalogue = async () => {
  try {
    const response = await fetch(`${API_BASE}/api/fonts`)
    if (!response.ok) throw new Error('Failed to fetch the font catalogue')
    fontCatalogue.value = await response.json()

    // Request exactly the fonts and weights the catalogue declares.
    const link = document.createElement('link')
    link.rel = 'stylesheet'
    link.href = fontCatalogue.value.stylesheet
    document.head.appendChild(link)
  } catch (error) {
    console.error('Error loading the font catalogue:', error)
  }
}

const sizeError = (label, value, min, max) => {
  if (!Number.isFinite(value) || value < min || value > max) {
    return `${label} must be between ${min} and ${max}.`
  }
  return ''
}

const clockFontSizeError = computed(() => sizeError(
  'Clock Font Size', settings.value.clockFontSize,
  CLOCK_FONT_SIZE_MIN.value, CLOCK_FONT_SIZE_MAX.value
))

const weekdayFontSizeError = computed(() => sizeError(
  'Weekday Font Size', settings.value.weekdayFontSize,
  SECONDARY_FONT_SIZE_MIN.value, SECONDARY_FONT_SIZE_MAX.value
))

const dateFontSizeError = computed(() => sizeError(
  'Date Font Size', settings.value.dateFontSize,
  SECONDARY_FONT_SIZE_MIN.value, SECONDARY_FONT_SIZE_MAX.value
))

const intervalOptions = [
  { value: '15', label: '15 minutes' },
  { value: '30', label: '30 minutes' },
  { value: '60', label: '1 hour' },
  { value: '120', label: '2 hours' }
]

const qualityOptions = [
  { value: '65', label: 'Low (65%)' },
  { value: '80', label: 'High (80%)' },
  { value: '100', label: 'Maximum (100%)' }
]

// Load settings from Idleview server.
//
// The `??` fallbacks below default to TRUE, matching Settings::default() in Rust. They
// used to default to false, so any field the server omitted would have silently blanked
// that element on the screen while the backend believed it was showing it.
const loadSettings = async (silent = false) => {
  try {
    if (!silent) isLoading.value = true
    isApplyingServerState = true
    connectionError.value = false

    const response = await fetch(`${API_BASE}/api/settings`)
    if (!response.ok) throw new Error('Failed to fetch settings')

    const data = await response.json()

    settings.value = {
      tempUnit: data.units?.temperature_unit || 'celsius',
      timeFormat: data.units?.time_format || '24h',
      dateFormat: data.units?.date_format || 'dmy',
      windUnit: data.units?.wind_speed_unit || 'kmh',
      // No normalize* here any more: the backend validates every font id and weight
      // against the catalogue before it stores them, so what it hands back is already
      // a font this role can use at a weight that font actually has.
      clockFont: data.display?.clock_font ?? 'roboto',
      clockFontWeight: String(data.display?.clock_font_weight ?? 400),
      clockFontSize: Number(data.display?.clock_font_size ?? 180),
      weekdayFont: data.display?.weekday_font ?? 'great_vibes',
      weekdayFontWeight: String(data.display?.weekday_font_weight ?? 400),
      weekdayFontSize: Number(data.display?.weekday_font_size ?? 70),
      dateFont: data.display?.date_font ?? 'kaushan_script',
      dateFontWeight: String(data.display?.date_font_weight ?? 400),
      dateFontSize: Number(data.display?.date_font_size ?? 40),
      showClock: data.display?.show_clock ?? true,
      showDate: data.display?.show_date ?? true,
      showWeekday: data.display?.show_weekday ?? true,
      showTemperature: data.display?.show_temperature ?? true,
      showHumidityWind: data.display?.show_humidity_wind ?? true,
      showPrecipitation: data.display?.show_precipitation_cloudiness ?? true,
      showSunriseSunset: data.display?.show_sunrise_sunset ?? true,
      showLocation: data.display?.show_location ?? true,
      showDebug: data.display?.show_debug ?? false,
      festivePhotos: data.photos?.enable_festive_queries ?? true,
      photoInterval: String(data.photos?.refresh_interval ?? 30),
      photoQuality: String(data.photos?.photo_quality ?? 80)
    }
    customQuery.value = data.photos?.custom_query ?? ''

    // Let the watcher see the new values land before it is allowed to fire again,
    // otherwise applying server state would immediately queue a save of that state.
    await nextTick()
  } catch (error) {
    console.error('Error loading settings:', error)
    connectionError.value = true
  } finally {
    isApplyingServerState = false
    isLoading.value = false
  }
}

// Load background photo
const loadBackgroundPhoto = async () => {
  try {
    const response = await fetch(`${API_BASE}/api/photo/current?t=${Date.now()}`)
    if (!response.ok) return

    const photoData = await response.json()
    if (!photoData?.url) return

    const imageUrl = photoData.url.includes('?')
      ? `${photoData.url}&t=${Date.now()}`
      : `${photoData.url}?t=${Date.now()}`

    // Preload the image before swapping — avoids any background flash
    const img = new Image()
    img.onload = () => {
      backgroundPhoto.value = imageUrl
      photoCredits.value = { author: photoData.author, authorUrl: photoData.author_url }
    }
    img.src = imageUrl
  } catch (error) {
    console.error('Error loading background photo:', error)
  }
}

// Send a write, surfacing a rejected token as a prompt to re-pair rather than a
// generic failure.
const authedFetch = async (path, options = {}) => {
  const response = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: { ...authHeaders(), ...(options.headers || {}) }
  })

  if (response.status === 401) {
    needsToken.value = true
    tokenError.value = token.value
      ? 'That token was rejected. Check the one shown on the Idleview screen.'
      : ''
    throw new Error('unauthorized')
  }

  if (!response.ok) throw new Error(`Request failed: ${response.status}`)
  return response
}

// One writer, one request shape.
//
// Settings used to be saved by a full-replace PUT while the custom query went through a
// merge PATCH, each on its own debounce. A PUT firing before the PATCH's response had
// landed would ship a stale custom_query and silently clobber what had just been typed.
// Everything now goes through a single debounced PATCH carrying the whole UI state, so
// there is no second writer to race with.
const buildPayload = () => ({
  units: {
    temperature_unit: settings.value.tempUnit,
    time_format: settings.value.timeFormat,
    date_format: settings.value.dateFormat,
    wind_speed_unit: settings.value.windUnit
  },
  display: {
    show_clock: settings.value.showClock,
    show_date: settings.value.showDate,
    show_weekday: settings.value.showWeekday,
    show_temperature: settings.value.showTemperature,
    show_humidity_wind: settings.value.showHumidityWind,
    show_precipitation_cloudiness: settings.value.showPrecipitation,
    show_sunrise_sunset: settings.value.showSunriseSunset,
    show_location: settings.value.showLocation,
    show_debug: settings.value.showDebug,
    clock_font: settings.value.clockFont,
    // Numbers, not words. "thin"/"regular"/"medium" mapped onto weights that half these
    // families do not publish; the backend now stores a real weight (100-900).
    clock_font_weight: Number(settings.value.clockFontWeight),
    clock_font_size: Number(settings.value.clockFontSize),
    weekday_font: settings.value.weekdayFont,
    weekday_font_weight: Number(settings.value.weekdayFontWeight),
    weekday_font_size: Number(settings.value.weekdayFontSize),
    date_font: settings.value.dateFont,
    date_font_weight: Number(settings.value.dateFontWeight),
    date_font_size: Number(settings.value.dateFontSize)
  },
  photos: {
    refresh_interval: Number(settings.value.photoInterval),
    // A number, matching the u8 the backend declares. This used to be sent as a number
    // and stored as a String, which is the only reason the backend needed a bespoke
    // string-or-number deserializer.
    photo_quality: Number(settings.value.photoQuality),
    enable_festive_queries: settings.value.festivePhotos,
    custom_query: customQuery.value
  }
})

const saveSettings = async () => {
  if (clockFontSizeError.value || weekdayFontSizeError.value || dateFontSizeError.value) {
    return
  }

  try {
    const response = await authedFetch('/api/settings', {
      method: 'PATCH',
      body: JSON.stringify(buildPayload())
    })
    await response.json()
    showMessage('✅ Settings saved successfully!', 'success')
  } catch (error) {
    if (error.message === 'unauthorized') return
    console.error('Error saving settings:', error)
    showMessage('❌ Failed to save settings', 'error')
  }
}

// Reset to defaults
const resetSettings = async () => {
  if (!confirm('Reset all settings to defaults? This cannot be undone.')) {
    return
  }

  try {
    await authedFetch('/api/settings/reset', { method: 'POST' })
    await loadSettings()
    showMessage('🔄️ Settings reset to defaults', 'success')
  } catch (error) {
    if (error.message === 'unauthorized') return
    console.error('Error resetting settings:', error)
    showMessage('❌ Failed to reset settings', 'error')
  }
}

// There is deliberately no Unsplash key field here. Photos come from a proxy that holds
// the key server-side, so a user never needs one - and the app never holds a secret that
// could be extracted from their machine.

// Ask the screen for a new photo right now. The dashboard has always listened for this
// event; until now nothing could emit it.
const refreshPhoto = async () => {
  isRefreshingPhoto.value = true
  try {
    await authedFetch('/api/photo/refresh', { method: 'POST' })
    showMessage('🔄️ New photo requested', 'success')
  } catch (error) {
    if (error.message !== 'unauthorized') {
      console.error('Error requesting a photo refresh:', error)
      showMessage('❌ Failed to request a new photo', 'error')
    }
  } finally {
    isRefreshingPhoto.value = false
  }
}

// Pair with the screen: check the typed token before storing it, so a typo is caught
// here rather than on the next edit.
const submitToken = async () => {
  const candidate = tokenInput.value.trim().toUpperCase()
  if (!candidate) return

  try {
    const response = await fetch(`${API_BASE}/api/auth/check`, {
      headers: { 'X-Idleview-Token': candidate }
    })
    if (!response.ok) {
      tokenError.value = 'That token was rejected. Check the one shown on the Idleview screen.'
      return
    }

    token.value = candidate
    localStorage.setItem(TOKEN_KEY, candidate)
    tokenInput.value = ''
    tokenError.value = ''
    needsToken.value = false

    // Only now are the settings fetched and rendered.
    await loadSettings()
    showMessage('✅ Paired with Idleview', 'success')
  } catch (error) {
    console.error('Error verifying token:', error)
    tokenError.value = 'Could not reach Idleview.'
  }
}

// Forget the token and drop straight back to the pairing prompt.
const unpair = () => {
  localStorage.removeItem(TOKEN_KEY)
  token.value = ''
  needsToken.value = true
  tokenError.value = ''
}

// A single debounced writer covering every editable field, including the custom query.
watch([settings, customQuery], () => {
  if (isLoading.value || isApplyingServerState || connectionError.value) return
  clearTimeout(saveDebounceTimer)
  saveDebounceTimer = setTimeout(saveSettings, 300)
}, { deep: true })

// Keep background image out of Vue's VDOM — update imperatively so re-renders never touch it
watch(backgroundPhoto, (url) => {
  if (bgImageRef.value) {
    bgImageRef.value.style.backgroundImage = url ? `url(${url})` : ''
  }
})

// SSE connection reference for cleanup
let sseConnection = null

// Setup Server-Sent Events for real-time updates
const setupSSE = () => {
  const eventSource = new EventSource(`${API_BASE}/api/events`)
  sseConnection = eventSource

  eventSource.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data)

      if (data.type === 'photo-updated') {
        loadBackgroundPhoto()
      } else if (data.type === 'settings-updated') {
        // Nothing to refresh while unpaired - the settings are not on screen.
        if (needsToken.value) return
        // Skip only the echo of our own write. The previous version muted every
        // settings event for a second after any save, so a second panel's change
        // landing in that window was dropped and this panel went quietly stale.
        if (data.origin && data.origin === clientId) return
        loadSettings(true)
      }
    } catch (error) {
      console.error('Error parsing SSE event:', error)
    }
  }

  eventSource.onopen = () => {
    console.log('SSE connection established')
  }

  eventSource.onerror = (error) => {
    console.error('SSE connection error:', error)
    eventSource.close()
    // Retry connection after 5 seconds
    setTimeout(() => {
      console.log('Reconnecting to SSE...')
      setupSSE()
    }, 5000)
  }

  return eventSource
}

// Is this panel paired? Checked before anything is fetched, because an unpaired panel
// shows no settings at all - not a read-only view of them.
const verifyStoredToken = async () => {
  if (!token.value) {
    needsToken.value = true
    return false
  }

  try {
    const response = await fetch(`${API_BASE}/api/auth/check`, {
      headers: { 'X-Idleview-Token': token.value }
    })
    needsToken.value = !response.ok
    return response.ok
  } catch (error) {
    console.error('Could not reach Idleview:', error)
    connectionError.value = true
    return false
  }
}

// Pair first, then load. The server would happily serve settings to an unpaired client
// (reads are open), so this ordering - not the API - is what keeps them off the screen.
const start = async () => {
  isLoading.value = true
  connectionError.value = false

  const paired = await verifyStoredToken()
  if (paired) {
    await loadSettings()
  } else {
    isLoading.value = false
  }
}

const retryConnection = () => start()

onMounted(() => {
  // Open, like the other reads - and needed before the pickers can render a font name
  // as anything but plain text.
  loadFontCatalogue()
  start()
  loadBackgroundPhoto()

  // Setup real-time updates via SSE
  setupSSE()
})

// Cleanup SSE connection on unmount
onBeforeUnmount(() => {
  clearTimeout(saveDebounceTimer)
  if (sseConnection) {
    console.log('Closing SSE connection')
    sseConnection.close()
    sseConnection = null
  }
})
</script>

<template>
  <div class="page-wrapper">
    <div class="background-image" ref="bgImageRef"></div>
    <div class="background-overlay"></div>
    <div class="container">
      <div class="content">
        <header>
          <h1><img :src="SettingsIcon" alt="Settings" class="title-icon" />Idleview Control</h1>
          <p class="subtitle">Configure your ambient display</p>
        </header>

        <div v-if="isLoading" class="loading-state">
          <p>Loading...</p>
        </div>

        <div v-else-if="connectionError" class="error-state">
          <p>⚠️ Cannot connect to Idleview app</p>
          <p class="error-details">Make sure the Idleview application is running on this computer.</p>
          <button class="btn btn-primary" @click="retryConnection">
            Retry Connection
          </button>
        </div>

        <!-- Until this panel is paired it shows nothing but the token prompt. The
             settings below are not rendered, and never fetched. -->
        <section v-else-if="needsToken" class="settings-group pairing-panel">
          <h2 class="pairing-heading">Pair with your screen</h2>
          <p class="pairing-copy">
            Enter the control token to manage this display. Press <strong>T</strong> on the
            Idleview screen to show it.
          </p>
          <form class="pairing-form" @submit.prevent="submitToken">
            <input
              v-model="tokenInput"
              type="text"
              class="number-input pairing-input"
              placeholder="e.g. K7PMX2QD"
              autocomplete="off"
              spellcheck="false"
              aria-label="Control token"
            />
            <button type="submit" class="btn btn-primary" :disabled="!tokenInput.trim()">
              Pair
            </button>
          </form>
          <p v-if="tokenError" class="setting-error">{{ tokenError }}</p>
        </section>

        <main v-else>
          <!-- Units Section -->
          <section class="settings-group">
            <h2 @click="toggleSection('units')" @keydown="handleHeaderKeydown($event, 'units')" tabindex="0"
              class="collapsible-header">
              <span class="header-left"><img :src="RulerIcon" alt="Units" class="section-icon" />Units</span>
              <svg class="chevron" :class="{ expanded: expandedSections.units }" width="20" height="20"
                viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M5 7.5L10 12.5L15 7.5" stroke="currentColor" stroke-width="2" stroke-linecap="round"
                  stroke-linejoin="round" />
              </svg>
            </h2>
            <div v-show="expandedSections.units" class="section-content">
              <SelectInput label="Temperature Unit" v-model="settings.tempUnit" :options="tempOptions" />
              <SelectInput label="Time Format" v-model="settings.timeFormat" :options="timeOptions" />
              <SelectInput label="Date Format" v-model="settings.dateFormat" :options="dateOptions" />
              <SelectInput label="Wind Speed Unit" v-model="settings.windUnit" :options="windOptions" />
            </div>
          </section>

          <!-- Display Section -->
          <section class="settings-group">
            <h2 @click="toggleSection('display')" @keydown="handleHeaderKeydown($event, 'display')" tabindex="0"
              class="collapsible-header">
              <span class="header-left"><img :src="MonitorIcon" alt="Display" class="section-icon" />Display</span>
              <svg class="chevron" :class="{ expanded: expandedSections.display }" width="20" height="20"
                viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M5 7.5L10 12.5L15 7.5" stroke="currentColor" stroke-width="2" stroke-linecap="round"
                  stroke-linejoin="round" />
              </svg>
            </h2>
            <div v-show="expandedSections.display" class="section-content">
              <ToggleSwitch label="Show Clock" v-model="settings.showClock" />
              <ToggleSwitch label="Show Date" v-model="settings.showDate" />
              <ToggleSwitch label="Show Weekday" v-model="settings.showWeekday" />
              <ToggleSwitch label="Show Temperature" v-model="settings.showTemperature" />
              <ToggleSwitch label="Show Humidity and Wind" v-model="settings.showHumidityWind" />
              <ToggleSwitch label="Show Precipitation and Cloudiness" v-model="settings.showPrecipitation" />
              <ToggleSwitch label="Show Sunrise and Sunset timers" v-model="settings.showSunriseSunset" />
              <ToggleSwitch label="Show Location" v-model="settings.showLocation" />
            </div>
          </section>

          <!-- Fonts Section -->
          <section class="settings-group">
            <h2 @click="toggleSection('fonts')" @keydown="handleHeaderKeydown($event, 'fonts')" tabindex="0"
              class="collapsible-header">
              <span class="header-left"><img :src="TypeIcon" alt="Fonts" class="section-icon" />Fonts</span>
              <svg class="chevron" :class="{ expanded: expandedSections.fonts }" width="20" height="20"
                viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M5 7.5L10 12.5L15 7.5" stroke="currentColor" stroke-width="2" stroke-linecap="round"
                  stroke-linejoin="round" />
              </svg>
            </h2>
            <div v-show="expandedSections.fonts" class="section-content">

              <!-- Editing a screen in another room is otherwise guess-and-check. -->
              <ScreenPreview
                v-if="fontCatalogue?.fonts"
                :display="settings"
                :fonts="fontCatalogue.fonts"
                :background-photo="backgroundPhoto"
              />

              <!-- Clock subsection -->
              <div class="subsection">
                <h3 @click="toggleSection('clockFonts')" @keydown="handleHeaderKeydown($event, 'clockFonts')" tabindex="0"
                  class="subsection-header collapsible-header">
                  <span class="header-left">Clock</span>
                  <svg class="chevron" :class="{ expanded: expandedSections.clockFonts }" width="20" height="20"
                    viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <path d="M5 7.5L10 12.5L15 7.5" stroke="currentColor" stroke-width="2" stroke-linecap="round"
                      stroke-linejoin="round" />
                  </svg>
                </h3>
                <div v-show="expandedSections.clockFonts" class="subsection-content section-content">
                  <FontPicker label="Clock Font" v-model="settings.clockFont" :fonts="clockFonts" preview-text="12:45" />
                  <SelectInput label="Font Weight" v-model="settings.clockFontWeight" :options="clockWeightOptions" />
                  <div class="setting-item number-setting">
                    <label for="clock-font-size">Clock Font Size</label>
                    <div class="number-input-wrapper">
                      <input id="clock-font-size" v-model.number="settings.clockFontSize" type="number"
                        :min="CLOCK_FONT_SIZE_MIN" :max="CLOCK_FONT_SIZE_MAX"
                        step="1" class="number-input" :class="{ invalid: clockFontSizeError }" />
                      <p v-if="clockFontSizeError" class="setting-error">{{ clockFontSizeError }}</p>
                    </div>
                  </div>
                </div>
              </div>

              <!-- Weekday subsection -->
              <div class="subsection">
                <h3 @click="toggleSection('weekdayFonts')" @keydown="handleHeaderKeydown($event, 'weekdayFonts')" tabindex="0"
                  class="subsection-header collapsible-header">
                  <span class="header-left">Weekday</span>
                  <svg class="chevron" :class="{ expanded: expandedSections.weekdayFonts }" width="20" height="20"
                    viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <path d="M5 7.5L10 12.5L15 7.5" stroke="currentColor" stroke-width="2" stroke-linecap="round"
                      stroke-linejoin="round" />
                  </svg>
                </h3>
                <div v-show="expandedSections.weekdayFonts" class="subsection-content section-content">
                  <FontPicker label="Weekday Font" v-model="settings.weekdayFont" :fonts="weekdayFonts" preview-text="Friday" />
                  <SelectInput label="Font Weight" v-model="settings.weekdayFontWeight" :options="weekdayWeightOptions" />
                  <div class="setting-item number-setting">
                    <label for="weekday-font-size">Weekday Font Size</label>
                    <div class="number-input-wrapper">
                      <input id="weekday-font-size" v-model.number="settings.weekdayFontSize" type="number"
                        :min="SECONDARY_FONT_SIZE_MIN" :max="SECONDARY_FONT_SIZE_MAX"
                        step="1" class="number-input" :class="{ invalid: weekdayFontSizeError }" />
                      <p v-if="weekdayFontSizeError" class="setting-error">{{ weekdayFontSizeError }}</p>
                    </div>
                  </div>
                </div>
              </div>

              <!-- Date subsection -->
              <div class="subsection">
                <h3 @click="toggleSection('dateFonts')" @keydown="handleHeaderKeydown($event, 'dateFonts')" tabindex="0"
                  class="subsection-header collapsible-header">
                  <span class="header-left">Date</span>
                  <svg class="chevron" :class="{ expanded: expandedSections.dateFonts }" width="20" height="20"
                    viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <path d="M5 7.5L10 12.5L15 7.5" stroke="currentColor" stroke-width="2" stroke-linecap="round"
                      stroke-linejoin="round" />
                  </svg>
                </h3>
                <div v-show="expandedSections.dateFonts" class="subsection-content section-content">
                  <FontPicker label="Date Font" v-model="settings.dateFont" :fonts="dateFonts" preview-text="14 Jul" />
                  <SelectInput label="Font Weight" v-model="settings.dateFontWeight" :options="dateWeightOptions" />
                  <div class="setting-item number-setting">
                    <label for="date-font-size">Date Font Size</label>
                    <div class="number-input-wrapper">
                      <input id="date-font-size" v-model.number="settings.dateFontSize" type="number"
                        :min="SECONDARY_FONT_SIZE_MIN" :max="SECONDARY_FONT_SIZE_MAX"
                        step="1" class="number-input" :class="{ invalid: dateFontSizeError }" />
                      <p v-if="dateFontSizeError" class="setting-error">{{ dateFontSizeError }}</p>
                    </div>
                  </div>
                </div>
              </div>

            </div>
          </section>

          <!-- Photo Settings -->
          <section class="settings-group">
            <h2 @click="toggleSection('photos')" class="collapsible-header">
              <span class="header-left"><img :src="ImageIcon" alt="Photos" class="section-icon" />Photos</span>
              <svg class="chevron" :class="{ expanded: expandedSections.photos }" width="20" height="20"
                viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M5 7.5L10 12.5L15 7.5" stroke="currentColor" stroke-width="2" stroke-linecap="round"
                  stroke-linejoin="round" />
              </svg>
            </h2>
            <div v-show="expandedSections.photos" class="section-content">
              <div class="setting-item">
                <label for="custom-query">Custom Search Query</label>
                <div class="number-input-wrapper">
                  <input id="custom-query" v-model="customQuery" type="text" class="number-input"
                    placeholder="e.g. misty forest" />
                </div>
              </div>
              <ToggleSwitch
                label="Enable Festive Photos (Christmas, New Year, Easter, etc.)"
                v-model="settings.festivePhotos"
                :disabled="!!customQuery.trim()"
                disabled-message="Festive photos are unavailable while a custom search query is active."
                @disabled-click="showMessage('⚠️ Festive photos cannot be toggled while a custom search query is active.', 'warning')"
              />
              <SelectInput label="Photo Refresh Interval" v-model="settings.photoInterval" :options="intervalOptions" />
              <SelectInput label="Photo Quality" v-model="settings.photoQuality" :options="qualityOptions" />

              <div class="dev-actions">
                <button class="btn btn-primary" @click="refreshPhoto" :disabled="isRefreshingPhoto">
                  <img :src="RefreshIcon" alt="" class="btn-icon" />
                  {{ isRefreshingPhoto ? 'Requesting…' : 'New Photo Now' }}
                </button>
              </div>
            </div>
          </section>

          <!-- Dev Section -->
          <section class="settings-group">
            <h2 @click="toggleSection('dev')" @keydown="handleHeaderKeydown($event, 'dev')" tabindex="0"
              class="collapsible-header">
              <span class="header-left"><img :src="BracesIcon" alt="Dev" class="section-icon" />Developer</span>
              <svg class="chevron" :class="{ expanded: expandedSections.dev }" width="20" height="20"
                viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M5 7.5L10 12.5L15 7.5" stroke="currentColor" stroke-width="2" stroke-linecap="round"
                  stroke-linejoin="round" />
              </svg>
            </h2>
            <div v-show="expandedSections.dev" class="section-content">
              <ToggleSwitch label="Show Debug Panel" v-model="settings.showDebug" />
              
              <div class="dev-actions">
                <button class="btn btn-danger" @click="resetSettings">
                  <img :src="ResetIcon" alt="Reset" class="btn-icon" />Reset to Defaults
                </button>
              </div>
            </div>
          </section>

          <!-- Unpairing is a connection action, not a developer tool, so it sits on its
               own rather than hidden inside the collapsed Developer section. -->
          <div class="account-actions">
            <button class="btn" @click="unpair">
              Unpair This Device
            </button>
          </div>

          <div class="messages-container">
            <div v-for="msg in messages" :key="msg.id" :class="['status-message', msg.type]">
              {{ msg.text }}
            </div>
          </div>
        </main>

        <footer>
          <div v-if="photoCredits" class="photo-credits">
            <h3>Current Photo</h3>
            <p>Photo by <a :href="photoCredits.authorUrl" target="_blank" rel="noopener">{{ photoCredits.author }}</a>
              on Unsplash</p>
          </div>
          <div v-else class="photo-credits">
            <p class="no-photo">No photo loaded yet</p>
          </div>
        </footer>
      </div>
    </div>
  </div>
</template>

<style scoped>
.page-wrapper {
  position: relative;
  min-height: 100vh;
}

.background-image {
  position: fixed;
  top: -10%;
  left: -10%;
  right: -10%;
  bottom: -10%;
  background-size: cover;
  background-position: center;
  filter: blur(10px);
  z-index: -2;
  will-change: transform;
}

.background-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.3);
  z-index: -1;
}

.container {
  position: relative;
  min-height: 100vh;
}

.content {
  position: relative;
  z-index: 1;
}

header {
  background: white;
  border-radius: 12px;
  padding: 1.5rem;
  margin-bottom: 1.5rem;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
  text-align: center;
}

header h1 {
  margin-bottom: 0.5rem;
}

header .subtitle {
  margin: 0;
}

.collapsible-header {
  cursor: pointer;
  user-select: none;
  display: flex;
  align-items: center;
  justify-content: space-between;
  transition: color 0.2s;
}

.collapsible-header .header-left {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.collapsible-header:hover {
  color: #1976D2;
}

.chevron {
  transition: transform 0.3s;
  flex-shrink: 0;
}

.chevron.expanded {
  transform: rotate(180deg);
}

.section-content {
  animation: slideDown 0.3s ease-out;
}

.setting-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 1rem;
  padding: 1rem 0;
  border-bottom: 1px solid #e0e0e0;
}

.setting-item:last-child {
  border-bottom: none;
}

.setting-item > label {
  font-weight: 500;
  color: #333;
  flex: 1;
}

.number-input-wrapper {
  min-width: 200px;
  display: flex;
  flex-direction: column;
  align-items: flex-end;
}

.number-input {
  width: 200px;
  box-sizing: border-box;
  padding: 0.5rem 1rem;
  border: 2px solid #e0e0e0;
  border-radius: 8px;
  background-color: white;
  font-size: 1rem;
  transition: border-color 0.3s;
}

.number-input:hover {
  border-color: #2196F3;
}

.number-input:focus {
  outline: none;
  border-color: #2196F3;
  box-shadow: 0 0 0 3px rgba(33, 150, 243, 0.1);
}

.number-input.invalid {
  border-color: #e74c3c;
}

.setting-error {
  margin: 0.35rem 0 0;
  color: #e74c3c;
  font-size: 0.85rem;
}

.setting-placeholder {
  margin: 0;
  padding: 0.75rem 0;
  color: #999;
  font-size: 0.9rem;
  font-style: italic;
}

.subsection {
  margin: 0.75rem 0;
  border: 1px solid #e0e0e0;
  border-radius: 10px;
  overflow: hidden;
}

.subsection-header {
  margin: 0;
  padding: 0.75rem 1rem;
  font-size: 1.1rem;
  font-weight: 600;
  color: #2c3e50;
  background: white;
  border-bottom: 2px solid #3498db;
  cursor: pointer;
  user-select: none;
  display: flex;
  align-items: center;
  justify-content: space-between;
  transition: color 0.2s;
}

.subsection-header:hover {
  color: #1976D2;
}

.subsection-header .header-left {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.subsection-content {
  padding: 0 1rem;
}

.subsection-content .setting-item:last-child {
  border-bottom: none;
}



@keyframes slideDown {
  from {
    opacity: 0;
    max-height: 0;
  }

  to {
    opacity: 1;
    max-height: 1000px;
  }
}

.pairing-panel {
  border: 2px solid #f0a500;
}

.pairing-heading {
  margin: 0 0 0.5rem;
}

.pairing-copy {
  margin: 0 0 1rem;
  color: #555;
  font-size: 0.9rem;
}

.pairing-form {
  display: flex;
  gap: 0.75rem;
  align-items: center;
  flex-wrap: wrap;
}

.pairing-input {
  flex: 1;
  min-width: 12rem;
  font-family: monospace;
  letter-spacing: 0.12em;
  text-transform: uppercase;
}

.dev-actions {
  margin: 1.5rem 0;
  display: flex;
  justify-content: center;
  gap: 0.75rem;
  flex-wrap: wrap;
}

.dev-actions .btn {
  min-width: 200px;
}

.account-actions {
  margin: 1.5rem 0;
  display: flex;
  justify-content: center;
}

.account-actions .btn {
  min-width: 200px;
}

.photo-credits {
  margin-top: 2rem;
  padding-top: 1.5rem;
  text-align: center;
  background: white;
  border-radius: 12px;
  padding: 1.5rem;
  margin-bottom: 1.5rem;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
}

.photo-credits h3 {
  font-size: 1rem;
  font-weight: 600;
  color: #2c3e50;
  margin: 0 0 0.5rem 0;
}

.photo-credits p {
  margin: 0;
  color: #7f8c8d;
  font-size: 0.9rem;
}

.photo-credits a {
  color: #1976D2;
  text-decoration: none;
  font-weight: 500;
}

.photo-credits a:hover {
  text-decoration: underline;
}

.photo-credits .no-photo {
  font-style: italic;
  color: #bdc3c7;
}
</style>
