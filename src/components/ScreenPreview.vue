<!--
  A scaled mock of what the wall display will look like.

  Configuring a screen in another room from a phone is otherwise blind: you change a
  font, walk over, look, walk back. The real sizes (a 180px clock) cannot be shown at
  actual scale on a phone, so everything is divided by a fixed factor - the proportions
  are what matter, and they are preserved exactly.

  The composition mirrors the dashboard (see src/index.html and src/styles.css): the
  clock centred with its accent underline, and the weekday above the date. The location
  badge and the bottom weather dock are deliberately left out - this pane previews
  typography, and neither carries a font choice worth previewing.
-->
<template>
  <div class="preview">
    <div class="preview-frame" :style="frameStyle">
      <div class="preview-dim"></div>

      <div class="preview-center">
        <div v-if="display.showClock" class="preview-clock" :style="clockStyle">
          {{ clockText }}
        </div>
        <div v-if="display.showWeekday || display.showDate" class="preview-date">
          <span v-if="display.showWeekday" class="preview-weekday" :style="weekdayStyle">
            {{ weekdayText }}
          </span>
          <span v-if="display.showDate" class="preview-date-value" :style="dateStyle">
            {{ dateText }}
          </span>
        </div>
      </div>
    </div>
    <p class="preview-caption">Live preview — proportions to scale</p>
  </div>
</template>

<script setup>
import { computed } from 'vue'

const props = defineProps({
  display: { type: Object, required: true },
  fonts: { type: Array, required: true },
  backgroundPhoto: { type: String, default: '' }
})

// The dashboard clock is 120-260px. Divide by this so it fits a phone while keeping the
// clock/weekday/date size relationships honest.
const SCALE = 4.5

const stackFor = (id) => props.fonts.find(font => font.id === id)?.stack || 'sans-serif'
// Optical correction: font-size sets the em-box, not the letters, so the same px renders
// visibly larger in a tall face than a short one. size_scale (measured from the real font
// files, see fonts.rs) evens the apparent cap-height out, matching the wall display.
const scaleFor = (id) => props.fonts.find(font => font.id === id)?.size_scale || 1
const scaled = (id, px) => `${(Number(px) * scaleFor(id)) / SCALE}px`

const clockStyle = computed(() => ({
  fontFamily: stackFor(props.display.clockFont),
  fontSize: scaled(props.display.clockFont, props.display.clockFontSize),
  fontWeight: props.display.clockFontWeight
}))

const weekdayStyle = computed(() => ({
  fontFamily: stackFor(props.display.weekdayFont),
  fontSize: scaled(props.display.weekdayFont, props.display.weekdayFontSize),
  fontWeight: props.display.weekdayFontWeight
}))

const dateStyle = computed(() => ({
  fontFamily: stackFor(props.display.dateFont),
  fontSize: scaled(props.display.dateFont, props.display.dateFontSize),
  fontWeight: props.display.dateFontWeight
}))

const frameStyle = computed(() => ({
  backgroundImage: props.backgroundPhoto ? `url(${props.backgroundPhoto})` : 'none'
}))

// Rendered from the settings actually in play, so 12h/24h and the date order are
// previewed too, not just the fonts.
const now = new Date()

const clockText = computed(() => {
  if (props.display.timeFormat === '12h') {
    return now.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })
  }
  return now.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false })
})

const weekdayText = computed(() => now.toLocaleDateString('en-US', { weekday: 'long' }))

const dateText = computed(() => {
  const day = String(now.getDate()).padStart(2, '0')
  const month = now.toLocaleDateString('en-US', { month: 'short' })
  const year = now.getFullYear()

  if (props.display.dateFormat === 'mdy') return `${month} ${day}, ${year}`
  if (props.display.dateFormat === 'ymd') return `${year} ${month} ${day}`
  return `${day} ${month} ${year}`
})
</script>

<style scoped>
.preview {
  margin-bottom: 1.5rem;
}

.preview-frame {
  position: relative;
  aspect-ratio: 16 / 9;
  border-radius: 12px;
  overflow: hidden;
  background-color: #2c3e50;
  background-size: cover;
  background-position: center;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.2);
  color: white;
}

.preview-dim {
  position: absolute;
  inset: 0;
  background: rgba(0, 0, 0, 0.35);
}

/* Absolutely centred, matching .center-content on the wall. */
.preview-center {
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  width: 100%;
  padding: 0 0.5rem;
  text-shadow: 0 2px 8px rgba(0, 0, 0, 0.5);
}

.preview-clock {
  position: relative;
  line-height: 1;
  letter-spacing: -0.035em;
  white-space: nowrap;
  padding-bottom: 0.35rem;
}

/* The accent hairline under the clock. */
.preview-clock::after {
  content: '';
  position: absolute;
  left: 50%;
  bottom: 0;
  width: 60%;
  height: 1.5px;
  transform: translateX(-50%);
  background: linear-gradient(90deg, rgba(255, 255, 255, 0.06), rgba(255, 255, 255, 0.56), rgba(255, 255, 255, 0.06));
  border-radius: 999px;
}

.preview-date {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.05rem;
  margin-top: 0.35rem;
  text-transform: uppercase;
  letter-spacing: 0.12em;
  line-height: 1.2;
}

.preview-weekday {
  white-space: nowrap;
  letter-spacing: 0.04em;
  text-transform: capitalize;
  opacity: 0.9;
}

.preview-date-value {
  white-space: nowrap;
  letter-spacing: 0.14em;
}

.preview-caption {
  margin: 0.5rem 0 0;
  text-align: center;
  font-size: 0.75rem;
  color: #7f8c8d;
}
</style>
