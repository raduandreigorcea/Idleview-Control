<script setup>
import { ref, onMounted, onBeforeUnmount, watch } from 'vue'
import SelectInput from './components/SelectInput.vue'
import ToggleSwitch from './components/ToggleSwitch.vue'
import RulerIcon from './assets/ruler-dimension-line.svg'
import MonitorIcon from './assets/monitor-cog.svg'
import ImageIcon from './assets/image.svg'
import SettingsIcon from './assets/settings.svg'
import ResetIcon from './assets/book-marked.svg'
import BracesIcon from './assets/braces.svg'


// API base URL - uses relative URLs
// Vite proxy handles forwarding to localhost:3000 in development
// In production, served from the same origin
const API_BASE = ''

const settings = ref({
  tempUnit: 'celsius',
  timeFormat: '24h',
  dateFormat: 'dmy',
  windUnit: 'kmh',
  showHumidityWind: true,
  showPrecipitation: true,
  showSunriseSunset: true,
  showCPU: false,
  showDebug: false,
  theme: 'default',
  cardPosition: 'left',
  festivePhotos: true,
  photoInterval: '30',
  photoQuality: '80'
})

const messages = ref([])
const isLoading = ref(true)
const connectionError = ref(false)
const backgroundPhoto = ref('')
const photoCredits = ref(null)
let messageIdCounter = 0
let ignoringSSEUpdate = false

// Track expanded sections - load from localStorage or default to collapsed
const loadExpandedSections = () => {
  const stored = localStorage.getItem('expandedSections')
  if (stored) {
    try {
      return JSON.parse(stored)
    } catch (e) {
      console.error('Error parsing stored sections:', e)
    }
  }
  return { units: false, display: false, photos: false, dev: false }
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
const themeOptions = [
  { value: 'default', label: 'Default' },
  { value: 'light', label: 'Light' },
  { value: 'minimal', label: 'Minimal' }
]

const cardPositionOptions = [
  { value: 'left', label: 'Left' },
  { value: 'right', label: 'Right' }
]
// Load settings from Idleview server
const loadSettings = async () => {
  try {
    isLoading.value = true
    connectionError.value = false
    const response = await fetch(`${API_BASE}/api/settings`)
    if (!response.ok) throw new Error('Failed to fetch settings')
    
    const data = await response.json()
    
    // Map server settings to UI format
    settings.value = {
      tempUnit: data.units?.temperature_unit || 'celsius',
      timeFormat: data.units?.time_format || '24h',
      dateFormat: data.units?.date_format || 'dmy',
      windUnit: data.units?.wind_speed_unit || 'kmh',
      showHumidityWind: data.display?.show_humidity_wind ?? false,
      showPrecipitation: data.display?.show_precipitation_cloudiness ?? false,
      showSunriseSunset: data.display?.show_sunrise_sunset ?? false,
      showCPU: data.display?.show_cpu_temp ?? false,
      theme: data.display?.theme || 'default',
      cardPosition: data.display?.card_position || 'left',
      festivePhotos: data.photos?.enable_festive_queries ?? true,
      showDebug: data.display?.show_debug ?? false,
      photoInterval: String(data.photos?.refresh_interval || 30),
      photoQuality: String(data.photos?.photo_quality || 80)
    }
    
    // Set isLoading to false after settings are applied to prevent auto-save trigger
    await new Promise(resolve => setTimeout(resolve, 0))
  } catch (error) {
    console.error('Error loading settings:', error)
    connectionError.value = true
  } finally {
    isLoading.value = false
  }
}

// Load background photo
const loadBackgroundPhoto = async () => {
  try {
    // Add cache-busting to force image refresh
    const response = await fetch(`${API_BASE}/api/photo/current?t=${Date.now()}`)
    if (response.ok) {
      const photoData = await response.json()
      console.log('Photo data received:', photoData)
      if (photoData && photoData.url) {
        // Add cache-busting to image URL
        const imageUrl = photoData.url.includes('?') 
          ? `${photoData.url}&t=${Date.now()}`
          : `${photoData.url}?t=${Date.now()}`
        
        // Test if image loads before setting it
        const img = new Image()
        img.onload = () => {
          backgroundPhoto.value = imageUrl
          photoCredits.value = {
            author: photoData.author,
            authorUrl: photoData.author_url
          }
          console.log('Background photo set to:', imageUrl)
          console.log('Photo credits:', photoCredits.value)
        }
        img.onerror = () => {
          console.error('Failed to load image:', imageUrl)
          backgroundPhoto.value = ''
          photoCredits.value = null
        }
        img.src = imageUrl
      } else {
        console.log('No photo URL in response')
        backgroundPhoto.value = ''
        photoCredits.value = null
      }
    } else {
      console.log('Photo endpoint returned:', response.status)
      backgroundPhoto.value = ''
      photoCredits.value = null
    }
  } catch (error) {
    console.error('Error loading photo:', error)
    backgroundPhoto.value = ''
    photoCredits.value = null
  }
}

// Save settings to Idleview server
const saveSettings = async () => {
  // Ignore SSE settings-updated events for a short time to prevent reload loop
  ignoringSSEUpdate = true
  setTimeout(() => { ignoringSSEUpdate = false }, 1000)
  
  try {
    // Map UI settings to server format
    const payload = {
      units: {
        temperature_unit: settings.value.tempUnit,
        time_format: settings.value.timeFormat,
        date_format: settings.value.dateFormat,
        wind_speed_unit: settings.value.windUnit
      },
      display: {
        show_humidity_wind: settings.value.showHumidityWind,
        show_precipitation_cloudiness: settings.value.showPrecipitation,
        show_sunrise_sunset: settings.value.showSunriseSunset,
        show_cpu_temp: settings.value.showCPU,
        theme: settings.value.theme,
        card_position: settings.value.cardPosition,
        show_debug: settings.value.showDebug
      },
      photos: {
        refresh_interval: parseInt(settings.value.photoInterval),
        photo_quality: parseInt(settings.value.photoQuality),
        enable_festive_queries: settings.value.festivePhotos
      }
    }

    const response = await fetch(`${API_BASE}/api/settings`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    })

    if (!response.ok) throw new Error('Failed to save settings')
    
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

// Watch settings and auto-save
watch(settings, () => {
  if (!isLoading.value && !connectionError.value) {
    saveSettings()
  }
}, { deep: true })

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
        loadSettings()
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
  if (sseConnection) {
    console.log('Closing SSE connection')
    sseConnection.close()
    sseConnection = null
  }
})
</script>

<template>
  <div class="page-wrapper">
    <div class="background-image" :style="backgroundPhoto ? { backgroundImage: `url(${backgroundPhoto})` } : {}"></div>
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
        <h2 @click="toggleSection('units')" @keydown="handleHeaderKeydown($event, 'units')" tabindex="0" class="collapsible-header">
          <span class="header-left"><img :src="RulerIcon" alt="Units" class="section-icon" />Units</span>
          <svg class="chevron" :class="{ expanded: expandedSections.units }" width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M5 7.5L10 12.5L15 7.5" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
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
        <h2 @click="toggleSection('display')" @keydown="handleHeaderKeydown($event, 'display')" tabindex="0" class="collapsible-header">
          <span class="header-left"><img :src="MonitorIcon" alt="Display" class="section-icon" />Display</span>
          <svg class="chevron" :class="{ expanded: expandedSections.display }" width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M5 7.5L10 12.5L15 7.5" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
        </h2>
        <div v-show="expandedSections.display" class="section-content">
        <SelectInput label="Theme" v-model="settings.theme" :options="themeOptions" />
        <ToggleSwitch label="Show Humidity and Wind" v-model="settings.showHumidityWind" />
        <ToggleSwitch label="Show Precipitation and Cloudiness" v-model="settings.showPrecipitation" />
        <ToggleSwitch label="Show Sunrise and Sunset timers" v-model="settings.showSunriseSunset" />
        <ToggleSwitch label="Show CPU Temperature (Linux systems only)" v-model="settings.showCPU" />
        </div>
      </section>

      <!-- Photo Settings -->
      <section class="settings-group">
        <h2 @click="toggleSection('photos')" class="collapsible-header">
          <span class="header-left"><img :src="ImageIcon" alt="Photos" class="section-icon" />Photos</span>
          <svg class="chevron" :class="{ expanded: expandedSections.photos }" width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M5 7.5L10 12.5L15 7.5" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
        </h2>
        <div v-show="expandedSections.photos" class="section-content">
        <ToggleSwitch label="Enable Festive Photos (Christmas, New Year, Easter, etc.)" v-model="settings.festivePhotos" />
        <SelectInput label="Photo Refresh Interval" v-model="settings.photoInterval" :options="intervalOptions" />
        <SelectInput label="Photo Quality" v-model="settings.photoQuality" :options="qualityOptions" />
        </div>
      </section>

      <!-- Dev Section -->
      <section class="settings-group">
        <h2 @click="toggleSection('dev')" @keydown="handleHeaderKeydown($event, 'dev')" tabindex="0" class="collapsible-header">
          <span class="header-left"><img :src="BracesIcon" alt="Dev" class="section-icon" />Developer</span>
          <svg class="chevron" :class="{ expanded: expandedSections.dev }" width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M5 7.5L10 12.5L15 7.5" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
        </h2>
        <div v-show="expandedSections.dev" class="section-content">
          <SelectInput label="Card Position" v-model="settings.cardPosition" :options="cardPositionOptions" />
          <ToggleSwitch label="Show Debug Panel" v-model="settings.showDebug" />
          
          <div class="dev-actions">
            <button class="btn btn-danger" @click="resetSettings">
              <img :src="ResetIcon" alt="Reset" class="btn-icon" />Reset to Defaults
            </button>
          </div>
          
          <div v-if="photoCredits" class="photo-credits">
            <h3>Current Photo</h3>
            <p>Photo by <a :href="photoCredits.authorUrl" target="_blank" rel="noopener">{{ photoCredits.author }}</a></p>
          </div>
          <div v-else class="photo-credits">
            <p class="no-photo">No photo loaded yet</p>
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
      <p>Idleview Control Panel · Connect from any device on your network</p>
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
  border-top: 1px solid #e0e0e0;
  text-align: center;
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
