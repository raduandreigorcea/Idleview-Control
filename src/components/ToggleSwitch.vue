<template>
  <label class="setting-item">
    <span>{{ label }}</span>
    <span class="switch">
      <input
        type="checkbox"
        role="switch"
        :checked="modelValue"
        @change="$emit('update:modelValue', $event.target.checked)"
      >
      <span class="slider"></span>
    </span>
  </label>
</template>

<script setup>
defineProps({
  label: { type: String, required: true },
  modelValue: { type: Boolean, required: true }
})

defineEmits(['update:modelValue'])
</script>

<style scoped>
/* The whole row is the label, so tapping the text toggles too. */
.setting-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 1rem;
  padding: 0.85rem 0;
  border-bottom: 1px solid #eee;
  cursor: pointer;
}

.setting-item:last-child {
  border-bottom: none;
}

.setting-item > span:first-child {
  font-weight: 500;
  color: #333;
}

.switch {
  position: relative;
  width: 48px;
  height: 28px;
  flex-shrink: 0;
}

.switch input {
  opacity: 0;
  width: 0;
  height: 0;
}

.slider {
  position: absolute;
  inset: 0;
  background-color: #ccc;
  border-radius: 28px;
  transition: 0.3s;
}

.slider::before {
  position: absolute;
  content: "";
  height: 22px;
  width: 22px;
  left: 3px;
  bottom: 3px;
  background-color: white;
  border-radius: 50%;
  transition: 0.3s;
}

input:checked + .slider {
  background-color: #2196f3;
}

input:focus-visible + .slider {
  outline: 2px solid #2196f3;
  outline-offset: 2px;
}

input:checked + .slider::before {
  transform: translateX(20px);
}
</style>
