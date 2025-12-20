<script setup>
import { ref, onMounted, watch } from 'vue'
import SelectInput from './components/SelectInput.vue'
import ToggleSwitch from './components/ToggleSwitch.vue'
import RulerIcon from './assets/ruler-dimension-line.svg'
import MonitorIcon from './assets/monitor-cog.svg'
import ImageIcon from './assets/image.svg'
import SettingsIcon from './assets/settings.svg'
import SaveIcon from './assets/save.svg'
import RefreshIcon from './assets/refresh-ccw.svg'
import ResetIcon from './assets/book-marked.svg'

// API endpoint - change this to match your Idleview app's server
// In production (served by Idleview app), uses relative URLs
// In development, uses localhost:3000
const API_BASE = import.meta.env.VITE_API_URL || (import.meta.env.DEV ? 'http://localhost:3000' : '')

const settings = ref({
  tempUnit: 'celsius',
  timeFormat: '24h',
  dateFormat: 'dmy',
  windUnit: 'kmh',
  showHumidityWind: false,
  showPrecipitation: false,
  showSunriseSunset: false,
  showCPU: false,
  photoInterval: '30',
  photoQuality: '85'
})

const statusMessage = ref('')
const messageType = ref('success')
const isLoading = ref(true)
const connectionError = ref(false)

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
  { value: '70', label: 'Low (70%)' },
  { value: '85', label: 'High (85%)' },
  { value: '100', label: 'Maximum (100%)' }
]

// Load settings from Idleview server
const loadSettings = async () => {
  try {
    isLoading.value = true
    connectionError.value = false
    statusMessage.value = ''
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
      photoInterval: String(data.photos?.refresh_interval || 30),
      photoQuality: data.photos?.photo_quality === 'high' ? '85' : 
                     data.photos?.photo_quality === 'low' ? '70' : '100'
    }
  } catch (error) {
    console.error('Error loading settings:', error)
    connectionError.value = true
    messageType.value = 'warning'
    statusMessage.value = '⚠️ Cannot connect to Idleview app. Make sure it is running.'
  } finally {
    isLoading.value = false
  }
}

// Save settings to Idleview server
const saveSettings = async () => {
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
        show_cpu_temp: settings.value.showCPU
      },
      photos: {
        refresh_interval: parseInt(settings.value.photoInterval),
        photo_quality: settings.value.photoQuality === '85' ? 'high' : 
                       settings.value.photoQuality === '70' ? 'low' : 'maximum'
      }
    }

    const response = await fetch(`${API_BASE}/api/settings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    })

    if (!response.ok) throw new Error('Failed to save settings')
    
    messageType.value = 'success'
    statusMessage.value = '✅ Settings saved successfully!'
    setTimeout(() => statusMessage.value = '', 5000)
  } catch (error) {
    console.error('Error saving settings:', error)
    messageType.value = 'error'
    statusMessage.value = '❌ Failed to save settings'
    setTimeout(() => statusMessage.value = '', 5000)
  }
}

// Refresh photo
const refreshPhoto = async () => {
  try {
    const response = await fetch(`${API_BASE}/api/refresh-photo`, { method: 'POST' })
    if (!response.ok) throw new Error('Failed to refresh photo')
    
    messageType.value = 'success'
    statusMessage.value = '🔄 Photo refreshed!'
    setTimeout(() => statusMessage.value = '', 5000)
  } catch (error) {
    console.error('Error refreshing photo:', error)
    messageType.value = 'error'
    statusMessage.value = '❌ Failed to refresh photo'
    setTimeout(() => statusMessage.value = '', 5000)
  }
}

// Reset to defaults
const resetSettings = async () => {
  try {
    const response = await fetch(`${API_BASE}/api/settings/reset`, { method: 'POST' })
    if (!response.ok) throw new Error('Failed to reset settings')
    
    await loadSettings() // Reload from server
    messageType.value = 'success'
    statusMessage.value = '↺ Settings reset to defaults'
    setTimeout(() => statusMessage.value = '', 5000)
  } catch (error) {
    console.error('Error resetting settings:', error)
    messageType.value = 'error'
    statusMessage.value = '❌ Failed to reset settings'
    setTimeout(() => statusMessage.value = '', 5000)
  }
}

// Watch settings and auto-save
watch(settings, () => {
  if (!isLoading.value && !connectionError.value) {
    saveSettings()
  }
}, { deep: true })

// Load settings on mount
onMounted(() => {
  loadSettings()
})
</script>

<template>
  <div class="container">
    <header>
      <h1><img :src="SettingsIcon" alt="Settings" class="title-icon" />Idleview Settings</h1>
      <p class="subtitle">Configure your ambient display</p>
    </header>

    <div v-if="isLoading" class="loading-state">
      <p>Loading settings...</p>
    </div>

    <div v-else-if="connectionError" class="error-state">
      <p>⚠️ Cannot connect to Idleview app</p>
      <p class="error-details">Make sure the Idleview application is running on this computer.</p>
      <button class="btn btn-primary" @click="loadSettings">
        <img :src="RefreshIcon" alt="Refresh" class="btn-icon" />Retry Connection
      </button>
    </div>

    <main v-else>
      <!-- Units Section -->
      <section class="settings-group">
        <h2><img :src="RulerIcon" alt="Units" class="section-icon" />Units</h2>
        <SelectInput label="Temperature Unit" v-model="settings.tempUnit" :options="tempOptions" />
        <SelectInput label="Time Format" v-model="settings.timeFormat" :options="timeOptions" />
        <SelectInput label="Date Format" v-model="settings.dateFormat" :options="dateOptions" />
        <SelectInput label="Wind Speed Unit" v-model="settings.windUnit" :options="windOptions" />
      </section>

      <!-- Display Section -->
      <section class="settings-group">
        <h2><img :src="MonitorIcon" alt="Display" class="section-icon" />Display</h2>
        <ToggleSwitch label="Show Humidity and Wind" v-model="settings.showHumidityWind" />
        <ToggleSwitch label="Show Precipitation and Cloudiness" v-model="settings.showPrecipitation" />
        <ToggleSwitch label="Show Sunrise and Sunset timers" v-model="settings.showSunriseSunset" />
        <ToggleSwitch label="Show CPU Temperature (Linux systems only)" v-model="settings.showCPU" />
      </section>

      <!-- Photo Settings -->
      <section class="settings-group">
        <h2><img :src="ImageIcon" alt="Photos" class="section-icon" />Photos</h2>
        <SelectInput label="Photo Refresh Interval" v-model="settings.photoInterval" :options="intervalOptions" />
        <SelectInput label="Photo Quality" v-model="settings.photoQuality" :options="qualityOptions" />
      </section>

      <!-- Actions -->
      <section class="settings-group actions">
        <button class="btn btn-secondary" @click="refreshPhoto">
          <img :src="RefreshIcon" alt="Refresh" class="btn-icon" />Refresh Photo Now
        </button>
        <button class="btn btn-danger" @click="resetSettings">
          <img :src="ResetIcon" alt="Reset" class="btn-icon" />Reset to Defaults
        </button>
      </section>

      <div v-if="statusMessage" :class="['status-message', messageType]">{{ statusMessage }}</div>
    </main>

    <footer>
      <p>Idleview Control Panel · Connect from any device on your network</p>
    </footer>
  </div>
</template>
