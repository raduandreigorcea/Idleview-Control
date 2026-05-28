<script setup>
import { ref, computed, onMounted, onBeforeUnmount, watch } from 'vue'
import SelectInput from './components/SelectInput.vue'
import ToggleSwitch from './components/ToggleSwitch.vue'
import RulerIcon from './assets/ruler-dimension-line.svg'
import MonitorIcon from './assets/monitor-cog.svg'
import ImageIcon from './assets/image.svg'
import SettingsIcon from './assets/settings.svg'
import ResetIcon from './assets/book-marked.svg'
import BracesIcon from './assets/braces.svg'
import TypeIcon from './assets/type-outline.svg'


// API base URL - uses relative URLs
// Vite proxy handles forwarding to localhost:3000 in development
// In production, served from the same origin
const API_BASE = ''

const settings = ref({
  tempUnit: 'celsius',
  timeFormat: '24h',
  dateFormat: 'dmy',
  windUnit: 'kmh',
  clockFont: 'roboto',
  clockFontWeight: 'regular',
  clockFontSize: 180,
  weekdayFont: 'great_vibes',
  weekdayFontWeight: 'thin',
  weekdayFontSize: 70,
  dateFont: 'kaushan_script',
  dateFontWeight: 'medium',
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
const serverSettings = ref({})
const customQuery = ref('')
let messageIdCounter = 0
let ignoringSSEUpdate = false
let isSilentReloading = false
let saveDebounceTimer = null
let customQueryDebounceTimer = null

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

const clockFontOptions = [
  { value: 'roboto', label: 'Roboto' },
  { value: 'open_sans', label: 'Open Sans' },
  { value: 'google_sans', label: 'Google Sans' },
  { value: 'inter', label: 'Inter' },
  { value: 'montserrat', label: 'Montserrat' },
  { value: 'poppins', label: 'Poppins' },
  { value: 'lato', label: 'Lato' },
  { value: 'noto_sans_japanese', label: 'Noto Sans Japanese' },
  { value: 'arimo', label: 'Arimo' },
  { value: 'roboto_condensed', label: 'Roboto Condensed' },
  { value: 'unbounded', label: 'Unbounded' }
]

const CLOCK_FONT_MAP = {
  roboto:             "'Roboto', sans-serif",
  open_sans:          "'Open Sans', sans-serif",
  google_sans:        "'Google Sans', sans-serif",
  inter:              "'Inter', sans-serif",
  montserrat:         "'Montserrat', sans-serif",
  poppins:            "'Poppins', sans-serif",
  lato:               "'Lato', sans-serif",
  noto_sans_japanese: "'Noto Sans JP', sans-serif",
  arimo:              "'Arimo', sans-serif",
  roboto_condensed:   "'Roboto Condensed', sans-serif",
  unbounded:          "'Unbounded', sans-serif"
}

const fontWeightOptions = [
  { value: 'thin', label: 'Thin' },
  { value: 'regular', label: 'Regular' },
  { value: 'medium', label: 'Medium' }
]

const normalizeClockFontValue = (value) => {
  if (clockFontOptions.some(o => o.value === value)) {
    return value
  }
  return 'roboto'
}

const weekdayFontOptions = [
  { value: 'sacramento', label: 'Sacramento' },
  { value: 'great_vibes', label: 'Great Vibes' },
  { value: 'dancing_script', label: 'Dancing Script' },
  { value: 'pacifico', label: 'Pacifico' },
  { value: 'satisfy', label: 'Satisfy' },
  { value: 'pinyon_script', label: 'Pinyon Script' },
  { value: 'alex_brush', label: 'Alex Brush' },
  { value: 'kaushan_script', label: 'Kaushan Script' },
  { value: 'italianno', label: 'Italianno' }
]

const WEEKDAY_FONT_MAP = {
  sacramento:     "'Sacramento', sans-serif",
  great_vibes:    "'Great Vibes', sans-serif",
  dancing_script: "'Dancing Script', sans-serif",
  pacifico:       "'Pacifico', sans-serif",
  satisfy:        "'Satisfy', sans-serif",
  pinyon_script:  "'Pinyon Script', sans-serif",
  alex_brush:     "'Alex Brush', sans-serif",
  kaushan_script: "'Kaushan Script', sans-serif",
  italianno:      "'Italianno', sans-serif"
}

const normalizeWeekdayFontValue = (value) => {
  if (weekdayFontOptions.some(o => o.value === value)) {
    return value
  }
  return 'great_vibes'
}

const dateFontOptions = [
  { value: 'sacramento', label: 'Sacramento' },
  { value: 'great_vibes', label: 'Great Vibes' },
  { value: 'dancing_script', label: 'Dancing Script' },
  { value: 'pacifico', label: 'Pacifico' },
  { value: 'satisfy', label: 'Satisfy' },
  { value: 'pinyon_script', label: 'Pinyon Script' },
  { value: 'alex_brush', label: 'Alex Brush' },
  { value: 'kaushan_script', label: 'Kaushan Script' },
  { value: 'italianno', label: 'Italianno' },
  { value: 'roboto', label: 'Roboto' },
  { value: 'open_sans', label: 'Open Sans' },
  { value: 'google_sans', label: 'Google Sans' },
  { value: 'inter', label: 'Inter' },
  { value: 'montserrat', label: 'Montserrat' },
  { value: 'poppins', label: 'Poppins' },
  { value: 'lato', label: 'Lato' },
  { value: 'noto_sans_japanese', label: 'Noto Sans Japanese' },
  { value: 'arimo', label: 'Arimo' },
  { value: 'roboto_condensed', label: 'Roboto Condensed' },
  { value: 'unbounded', label: 'Unbounded' }
]

const DATE_FONT_MAP = { ...WEEKDAY_FONT_MAP, ...CLOCK_FONT_MAP }

const normalizeDateFontValue = (value) => {
  if (dateFontOptions.some(o => o.value === value)) {
    return value
  }
  return 'kaushan_script'
}

const CLOCK_FONT_SIZE_MIN = 120
const CLOCK_FONT_SIZE_MAX = 260

const clockFontSizeError = computed(() => {
  if (!Number.isFinite(settings.value.clockFontSize)) {
    return `Clock Font Size must be between ${CLOCK_FONT_SIZE_MIN} and ${CLOCK_FONT_SIZE_MAX}.`
  }

  if (settings.value.clockFontSize < CLOCK_FONT_SIZE_MIN || settings.value.clockFontSize > CLOCK_FONT_SIZE_MAX) {
    return `Clock Font Size must be between ${CLOCK_FONT_SIZE_MIN} and ${CLOCK_FONT_SIZE_MAX}.`
  }

  return ''
})

const SECONDARY_FONT_SIZE_MIN = 40
const SECONDARY_FONT_SIZE_MAX = 200

const weekdayFontSizeError = computed(() => {
  if (!Number.isFinite(settings.value.weekdayFontSize)) {
    return `Weekday Font Size must be between ${SECONDARY_FONT_SIZE_MIN} and ${SECONDARY_FONT_SIZE_MAX}.`
  }
  if (settings.value.weekdayFontSize < SECONDARY_FONT_SIZE_MIN || settings.value.weekdayFontSize > SECONDARY_FONT_SIZE_MAX) {
    return `Weekday Font Size must be between ${SECONDARY_FONT_SIZE_MIN} and ${SECONDARY_FONT_SIZE_MAX}.`
  }
  return ''
})

const dateFontSizeError = computed(() => {
  if (!Number.isFinite(settings.value.dateFontSize)) {
    return `Date Font Size must be between ${SECONDARY_FONT_SIZE_MIN} and ${SECONDARY_FONT_SIZE_MAX}.`
  }
  if (settings.value.dateFontSize < SECONDARY_FONT_SIZE_MIN || settings.value.dateFontSize > SECONDARY_FONT_SIZE_MAX) {
    return `Date Font Size must be between ${SECONDARY_FONT_SIZE_MIN} and ${SECONDARY_FONT_SIZE_MAX}.`
  }
  return ''
})

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

// Load settings from Idleview server
const loadSettings = async (silent = false) => {
  try {
    if (!silent) {
      isLoading.value = true
    } else {
      isSilentReloading = true
    }
    connectionError.value = false
    const response = await fetch(`${API_BASE}/api/settings`)
    if (!response.ok) throw new Error('Failed to fetch settings')

    const data = await response.json()
    serverSettings.value = data

    // Map server settings to UI format
    settings.value = {
      tempUnit: data.units?.temperature_unit || 'celsius',
      timeFormat: data.units?.time_format || '24h',
      dateFormat: data.units?.date_format || 'dmy',
      windUnit: data.units?.wind_speed_unit || 'kmh',
      clockFont: normalizeClockFontValue(data.display?.clock_font),
      clockFontWeight: data.display?.clock_font_weight || 'regular',
      clockFontSize: Number(data.display?.clock_font_size ?? 180),
      weekdayFont: normalizeWeekdayFontValue(data.display?.weekday_font),
      weekdayFontWeight: data.display?.weekday_font_weight || 'thin',
      weekdayFontSize: Number(data.display?.weekday_font_size ?? 70),
      dateFont: normalizeDateFontValue(data.display?.date_font),
      dateFontWeight: data.display?.date_font_weight || 'medium',
      dateFontSize: Number(data.display?.date_font_size ?? 40),
      showClock: data.display?.show_clock ?? false,
      showDate: data.display?.show_date ?? false,
      showWeekday: data.display?.show_weekday ?? false,
      showTemperature: data.display?.show_temperature ?? false,
      showHumidityWind: data.display?.show_humidity_wind ?? false,
      showPrecipitation: data.display?.show_precipitation_cloudiness ?? false,
      showSunriseSunset: data.display?.show_sunrise_sunset ?? false,
      showLocation: data.display?.show_location ?? false,
      festivePhotos: data.photos?.enable_festive_queries ?? true,
      showDebug: data.display?.show_debug ?? false,
      photoInterval: String(data.photos?.refresh_interval || 30),
      photoQuality: String(data.photos?.photo_quality || 80)
    }
    customQuery.value = data.photos?.custom_query ?? ''

    // Set isLoading to false after settings are applied to prevent auto-save trigger
    await new Promise(resolve => setTimeout(resolve, 0))
  } catch (error) {
    console.error('Error loading settings:', error)
    connectionError.value = true
  } finally {
    isLoading.value = false
    isSilentReloading = false
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

// Save settings to Idleview server
const saveSettings = async () => {
  if (clockFontSizeError.value || weekdayFontSizeError.value || dateFontSizeError.value) {
    return
  }

  // Ignore SSE settings-updated events for a short time to prevent reload loop
  ignoringSSEUpdate = true
  setTimeout(() => { ignoringSSEUpdate = false }, 1000)

  try {
    // Merge UI values into the last full server payload so unknown fields are preserved.
    const payload = JSON.parse(JSON.stringify(serverSettings.value || {}))
    payload.units = {
      ...(payload.units || {}),
      temperature_unit: settings.value.tempUnit,
      time_format: settings.value.timeFormat,
      date_format: settings.value.dateFormat,
      wind_speed_unit: settings.value.windUnit
    }
    payload.display = {
      ...(payload.display || {}),
      show_clock: settings.value.showClock,
      show_date: settings.value.showDate,
      show_weekday: settings.value.showWeekday,
      show_temperature: settings.value.showTemperature,
      show_humidity_wind: settings.value.showHumidityWind,
      show_precipitation_cloudiness: settings.value.showPrecipitation,
      show_sunrise_sunset: settings.value.showSunriseSunset,
      show_location: settings.value.showLocation,
      clock_font: settings.value.clockFont,
      clock_font_weight: settings.value.clockFontWeight,
      clock_font_size: settings.value.clockFontSize,
      weekday_font: settings.value.weekdayFont,
      weekday_font_weight: settings.value.weekdayFontWeight,
      weekday_font_size: settings.value.weekdayFontSize,
      date_font: settings.value.dateFont,
      date_font_weight: settings.value.dateFontWeight,
      date_font_size: settings.value.dateFontSize,
      show_debug: settings.value.showDebug
    }
    payload.photos = {
      ...(payload.photos || {}),
      refresh_interval: parseInt(settings.value.photoInterval),
      photo_quality: parseInt(settings.value.photoQuality),
      enable_festive_queries: settings.value.festivePhotos
    }

    const response = await fetch(`${API_BASE}/api/settings`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    })

    if (!response.ok) throw new Error('Failed to save settings')

    serverSettings.value = payload

    showMessage('✅ Settings saved successfully!', 'success')
  } catch (error) {
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
    const response = await fetch(`${API_BASE}/api/settings/reset`, { method: 'POST' })
    if (!response.ok) throw new Error('Failed to reset settings')

    await loadSettings() // Reload from server
    showMessage('🔄️ Settings reset to defaults', 'success')
  } catch (error) {
    console.error('Error resetting settings:', error)
    showMessage('❌ Failed to reset settings', 'error')
  }
}

// Save custom photo query via PATCH (deep-merge — only custom_query changes)
const saveCustomQuery = async () => {
  ignoringSSEUpdate = true
  setTimeout(() => { ignoringSSEUpdate = false }, 1000)
  try {
    const response = await fetch(`${API_BASE}/api/settings`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ photos: { custom_query: customQuery.value } })
    })
    if (!response.ok) throw new Error('Failed to save custom query')
    const updated = await response.json()
    serverSettings.value = updated
    showMessage('✅ Settings saved successfully!', 'success')
  } catch (error) {
    console.error('Error saving custom query:', error)
    showMessage('❌ Failed to save settings', 'error')
  }
}

// Watch settings and auto-save (debounced to reduce PUT requests and SSE noise)
watch(settings, () => {
  if (!isLoading.value && !isSilentReloading && !connectionError.value) {
    clearTimeout(saveDebounceTimer)
    saveDebounceTimer = setTimeout(saveSettings, 300)
  }
}, { deep: true })

// Watch customQuery and PATCH (debounced)
watch(customQuery, () => {
  if (!isLoading.value && !isSilentReloading && !connectionError.value) {
    clearTimeout(customQueryDebounceTimer)
    customQueryDebounceTimer = setTimeout(saveCustomQuery, 300)
  }
})

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
      console.log('SSE event received:', data)

      if (data.type === 'photo-updated') {
        console.log('Photo updated, reloading...')
        loadBackgroundPhoto()
      } else if (data.type === 'settings-updated') {
        if (ignoringSSEUpdate) {
          console.log('Settings updated by us, ignoring SSE event')
          return
        }
        console.log('Settings updated externally, reloading...')
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

// Load settings on mount
onMounted(() => {
  loadSettings()
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
          <p>Loading settings...</p>
        </div>

        <div v-else-if="connectionError" class="error-state">
          <p>⚠️ Cannot connect to Idleview app</p>
          <p class="error-details">Make sure the Idleview application is running on this computer.</p>
          <button class="btn btn-primary" @click="loadSettings">
            Retry Connection
          </button>
        </div>

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
                  <div class="setting-item">
                    <label for="clock-font">Clock Font</label>
                    <select id="clock-font" class="font-preview-select"
                      v-model="settings.clockFont"
                      :style="{ fontFamily: CLOCK_FONT_MAP[settings.clockFont] }">
                      <option v-for="opt in clockFontOptions" :key="opt.value" :value="opt.value"
                        :style="{ fontFamily: CLOCK_FONT_MAP[opt.value] }">
                        {{ opt.label }}
                      </option>
                    </select>
                  </div>
                  <SelectInput label="Font Weight" v-model="settings.clockFontWeight" :options="fontWeightOptions" />
                  <div class="setting-item number-setting">
                    <label for="clock-font-size">Clock Font Size</label>
                    <div class="number-input-wrapper">
                      <input id="clock-font-size" v-model.number="settings.clockFontSize" type="number" min="120" max="260"
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
                  <div class="setting-item">
                    <label for="weekday-font">Weekday Font</label>
                    <select id="weekday-font" class="font-preview-select"
                      v-model="settings.weekdayFont"
                      :style="{ fontFamily: WEEKDAY_FONT_MAP[settings.weekdayFont] }">
                      <option v-for="opt in weekdayFontOptions" :key="opt.value" :value="opt.value"
                        :style="{ fontFamily: WEEKDAY_FONT_MAP[opt.value] }">
                        {{ opt.label }}
                      </option>
                    </select>
                  </div>
                  <SelectInput label="Font Weight" v-model="settings.weekdayFontWeight" :options="fontWeightOptions" />
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
                  <div class="setting-item">
                    <label for="date-font">Date Font</label>
                    <select id="date-font" class="font-preview-select"
                      v-model="settings.dateFont"
                      :style="{ fontFamily: DATE_FONT_MAP[settings.dateFont] }">
                      <option v-for="opt in dateFontOptions" :key="opt.value" :value="opt.value"
                        :style="{ fontFamily: DATE_FONT_MAP[opt.value] }">
                        {{ opt.label }}
                      </option>
                    </select>
                  </div>
                  <SelectInput label="Font Weight" v-model="settings.dateFontWeight" :options="fontWeightOptions" />
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

.font-preview-select {
  padding: 0 1rem;
  border: 2px solid #e0e0e0;
  border-radius: 8px;
  background-color: white;
  font-size: 1.1rem;
  cursor: pointer;
  width: 200px;
  height: 2.5rem;
  box-sizing: border-box;
  transition: border-color 0.3s;
}

.font-preview-select:hover {
  border-color: #2196F3;
}

.font-preview-select:focus {
  outline: none;
  border-color: #2196F3;
  box-shadow: 0 0 0 3px rgba(33, 150, 243, 0.1);
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

.dev-actions {
  margin: 1.5rem 0;
  display: flex;
  justify-content: center;
}

.dev-actions .btn {
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
