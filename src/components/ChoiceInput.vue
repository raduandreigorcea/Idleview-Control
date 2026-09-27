<template>
  <div class="setting-item">
    <span class="label" :id="id">{{ label }}</span>
    <div class="choices" role="radiogroup" :aria-labelledby="id">
      <button
        v-for="option in options"
        :key="option.value"
        type="button"
        role="radio"
        :aria-checked="option.value === modelValue"
        :class="{ selected: option.value === modelValue }"
        @click="$emit('update:modelValue', option.value)"
      >
        {{ option.label }}
      </button>
    </div>
  </div>
</template>

<script setup>
import { computed } from 'vue'

// A row of buttons rather than a dropdown: every option is visible and one tap away,
// which is what a phone in one hand wants.
const props = defineProps({
  label: { type: String, required: true },
  modelValue: { type: [String, Number], required: true },
  options: { type: Array, required: true }
})

defineEmits(['update:modelValue'])

const id = computed(() => `choice-${props.label.toLowerCase().replace(/\s+/g, '-')}`)
</script>

<style scoped>
.setting-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  flex-wrap: wrap;
  gap: 0.5rem 1rem;
  padding: 0.85rem 0;
  border-bottom: 1px solid #eee;
}

.setting-item:last-child {
  border-bottom: none;
}

.label {
  font-weight: 500;
  color: #333;
}

.choices {
  display: inline-flex;
  background: #f1f3f5;
  border-radius: 10px;
  padding: 3px;
  gap: 2px;
}

button {
  border: none;
  background: transparent;
  padding: 0.5rem 0.8rem;
  border-radius: 8px;
  font-size: 0.95rem;
  color: #555;
  cursor: pointer;
  min-height: 40px;
}

button.selected {
  background: white;
  color: #1565c0;
  font-weight: 600;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.15);
}

button:focus-visible {
  outline: 2px solid #2196f3;
  outline-offset: 1px;
}
</style>
