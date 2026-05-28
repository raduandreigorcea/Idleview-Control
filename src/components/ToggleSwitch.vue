<template>
  <div class="setting-item" :class="{ 'setting-item--disabled': disabled }">
    <label>
      <span>{{ label }}</span>
    </label>
    <label class="switch" :title="disabled ? disabledMessage : undefined">
      <input
        type="checkbox"
        :checked="modelValue"
        :disabled="disabled"
        @change="handleChange($event)"
      >
      <span class="slider round" @click="disabled && emit('disabled-click')"></span>
    </label>
  </div>
</template>

<script setup>
const props = defineProps({
  label: {
    type: String,
    required: true
  },
  modelValue: {
    type: Boolean,
    required: true
  },
  disabled: {
    type: Boolean,
    default: false
  },
  disabledMessage: {
    type: String,
    default: ''
  }
})

const emit = defineEmits(['update:modelValue', 'disabled-click'])

const handleChange = (event) => {
  if (props.disabled) {
    event.target.checked = props.modelValue
    emit('disabled-click')
    return
  }
  emit('update:modelValue', event.target.checked)
}
</script>

<style scoped>
.setting-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 1rem 0;
  border-bottom: 1px solid #e0e0e0;
}

.setting-item:last-child {
  border-bottom: none;
}

label span {
  font-weight: 500;
  color: #333;
}

.switch {
  position: relative;
  display: block;
  width: 44px;
  height: 24px;
  flex-shrink: 0;
}

.switch input { 
  opacity: 0;
  width: 0;
  height: 0;
}

.setting-item--disabled {
  opacity: 0.5;
}

.setting-item--disabled .switch {
  cursor: not-allowed;
}

.setting-item--disabled .slider {
  cursor: not-allowed;
}

.slider {
  position: absolute;
  cursor: pointer;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background-color: #ccc;
  transition: .4s;
}

.slider:before {
  position: absolute;
  content: "";
  height: 18px;
  width: 18px;
  left: 3px;
  bottom: 3px;
  background-color: white;
  transition: .4s;
}

input:checked + .slider {
  background-color: #2196F3;
}

input:focus + .slider {
  box-shadow: 0 0 1px #2196F3;
}

input:checked + .slider:before {
  transform: translateX(20px);
}

.slider.round {
  border-radius: 34px;
}

.slider.round:before {
  border-radius: 50%;
}
</style>
