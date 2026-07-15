<!--
  A custom listbox, not a native <select>.

  The old control used `<option :style="{ fontFamily }">` to preview each font. Chrome on
  desktop honours that; the native pickers on iOS and Android ignore option styling
  entirely, so on the phone you actually configure the screen from, every font in the
  list rendered identically in the system font. The preview was decorative at best.

  This renders the options itself, so the preview works everywhere - and at a size where
  a script face is actually legible, which 1.1rem was not.
-->
<template>
  <div class="setting-item font-picker" ref="rootRef">
    <label :id="`${id}-label`">{{ label }}</label>

    <div class="picker-wrapper">
      <button
        type="button"
        class="picker-trigger"
        :aria-labelledby="`${id}-label`"
        aria-haspopup="listbox"
        :aria-expanded="isOpen"
        :style="{ fontFamily: selectedFont?.stack }"
        @click="toggle"
        @keydown="onTriggerKeydown"
      >
        <span class="picker-sample" :style="{ fontSize: sampleSize(selectedFont) }">{{ previewText }}</span>
        <span class="picker-name">{{ selectedFont?.label || modelValue }}</span>
        <svg class="picker-chevron" :class="{ expanded: isOpen }" width="18" height="18"
          viewBox="0 0 20 20" fill="none" aria-hidden="true">
          <path d="M5 7.5L10 12.5L15 7.5" stroke="currentColor" stroke-width="2"
            stroke-linecap="round" stroke-linejoin="round" />
        </svg>
      </button>

      <ul
        v-if="isOpen"
        class="picker-list"
        role="listbox"
        :aria-labelledby="`${id}-label`"
        @keydown="onListKeydown"
        tabindex="-1"
        ref="listRef"
      >
        <li
          v-for="(font, index) in fonts"
          :key="font.id"
          role="option"
          :aria-selected="font.id === modelValue"
          :class="['picker-option', { selected: font.id === modelValue, active: index === activeIndex }]"
          :style="{ fontFamily: font.stack }"
          @click="choose(font.id)"
          @mouseenter="activeIndex = index"
        >
          <span class="option-sample" :style="{ fontSize: sampleSize(font) }">{{ previewText }}</span>
          <span class="option-name">{{ font.label }}</span>
        </li>
      </ul>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, onBeforeUnmount, nextTick } from 'vue'

const props = defineProps({
  label: { type: String, required: true },
  modelValue: { type: String, required: true },
  // Font definitions straight from the backend catalogue: { id, label, stack, weights }
  fonts: { type: Array, required: true },
  previewText: { type: String, default: 'Aa' }
})

const emit = defineEmits(['update:modelValue'])

const isOpen = ref(false)
const activeIndex = ref(-1)
const rootRef = ref(null)
const listRef = ref(null)

const id = computed(() => props.label.toLowerCase().replace(/\s+/g, '-'))
const selectedFont = computed(() => props.fonts.find(font => font.id === props.modelValue))

// The samples share a base size, but font-size sets the em-box, not the letters, so a tall
// face looks bigger than a short one at the same value. size_scale (from the catalogue,
// measured from the real font files) evens the apparent size out - the same correction the
// wall display and the preview apply, so the list matches what you'll get.
const SAMPLE_BASE_REM = 1.6
const sampleSize = (font) => `${SAMPLE_BASE_REM * (font?.size_scale || 1)}rem`

const open = async () => {
  isOpen.value = true
  activeIndex.value = Math.max(0, props.fonts.findIndex(font => font.id === props.modelValue))
  await nextTick()
  listRef.value?.focus()
}

const close = () => {
  isOpen.value = false
  activeIndex.value = -1
}

const toggle = () => (isOpen.value ? close() : open())

const choose = (fontId) => {
  emit('update:modelValue', fontId)
  close()
}

const onTriggerKeydown = (event) => {
  if (['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(event.key)) {
    event.preventDefault()
    open()
  }
}

const onListKeydown = (event) => {
  if (event.key === 'Escape') {
    event.preventDefault()
    close()
    return
  }
  if (event.key === 'Enter' || event.key === ' ') {
    event.preventDefault()
    const font = props.fonts[activeIndex.value]
    if (font) choose(font.id)
    return
  }
  if (event.key === 'ArrowDown') {
    event.preventDefault()
    activeIndex.value = (activeIndex.value + 1) % props.fonts.length
    return
  }
  if (event.key === 'ArrowUp') {
    event.preventDefault()
    activeIndex.value = (activeIndex.value - 1 + props.fonts.length) % props.fonts.length
  }
}

const onDocumentPointerDown = (event) => {
  if (isOpen.value && rootRef.value && !rootRef.value.contains(event.target)) close()
}

onMounted(() => document.addEventListener('pointerdown', onDocumentPointerDown))
onBeforeUnmount(() => document.removeEventListener('pointerdown', onDocumentPointerDown))
</script>

<style scoped>
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

label {
  font-weight: 500;
  color: #333;
  flex: 1;
}

.picker-wrapper {
  position: relative;
  width: 200px;
  flex-shrink: 0;
}

.picker-trigger {
  display: flex;
  align-items: center;
  gap: 0.6rem;
  width: 100%;
  padding: 0.5rem 0.75rem;
  border: 2px solid #e0e0e0;
  border-radius: 8px;
  background: white;
  cursor: pointer;
  text-align: left;
  transition: border-color 0.3s;
}

.picker-trigger:hover {
  border-color: #2196F3;
}

.picker-trigger:focus-visible {
  outline: none;
  border-color: #2196F3;
  box-shadow: 0 0 0 3px rgba(33, 150, 243, 0.1);
}

/* The sample renders in the font itself, large enough that a script face reads. */
.picker-sample {
  font-size: 1.6rem;
  line-height: 1.4;
  min-width: 2.2rem;
  color: #2c3e50;
}

.picker-name {
  flex: 1;
  font-family: system-ui, sans-serif;
  font-size: 0.9rem;
  color: #555;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.picker-chevron {
  flex-shrink: 0;
  color: #999;
  transition: transform 0.3s;
}

.picker-chevron.expanded {
  transform: rotate(180deg);
}

.picker-list {
  position: absolute;
  top: calc(100% + 4px);
  left: 0;
  right: 0;
  z-index: 20;
  margin: 0;
  padding: 0.25rem;
  list-style: none;
  background: white;
  border: 2px solid #2196F3;
  border-radius: 8px;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.15);
  max-height: 17rem;
  overflow-y: auto;
  outline: none;
}

.picker-option {
  display: flex;
  align-items: center;
  gap: 0.6rem;
  padding: 0.45rem 0.6rem;
  border-radius: 6px;
  cursor: pointer;
}

.picker-option.active {
  background: #e3f2fd;
}

.picker-option.selected {
  background: #2196F3;
  color: white;
}

.option-sample {
  font-size: 1.6rem;
  line-height: 1.5;
  min-width: 2.2rem;
}

.option-name {
  font-family: system-ui, sans-serif;
  font-size: 0.85rem;
  opacity: 0.8;
}

/* On a phone the row is the whole width, so give the sample more room. */
@media (max-width: 640px) {
  .setting-item {
    flex-direction: column;
    align-items: stretch;
  }

  .picker-wrapper {
    width: 100%;
  }
}
</style>
