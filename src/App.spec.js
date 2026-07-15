import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import App from './App.vue'

// The panel talks to the Idleview app over fetch and SSE. Neither exists in jsdom, so
// both are stubbed and the responses are scripted per test.
const VALID_TOKEN = 'K7PMX2QD'

const settingsPayload = {
  units: { temperature_unit: 'celsius', time_format: '24h', date_format: 'dmy', wind_speed_unit: 'kmh' },
  display: {
    show_clock: true, show_date: true, show_weekday: true, show_temperature: true,
    show_humidity_wind: true, show_precipitation_cloudiness: true, show_sunrise_sunset: true,
    show_location: true, show_debug: false,
    // Numeric weights, as the backend now stores them.
    clock_font: 'roboto', clock_font_weight: 400, clock_font_size: 180,
    weekday_font: 'great_vibes', weekday_font_weight: 400, weekday_font_size: 70,
    date_font: 'kaushan_script', date_font_weight: 400, date_font_size: 40
  },
  photos: { refresh_interval: 30, photo_quality: 80, enable_festive_queries: true, custom_query: '' }
}

// Mirrors the shape of GET /api/fonts. Arimo genuinely has no weight below 400 and
// Kaushan Script has only 400 - that is the whole point of serving the catalogue.
const fontsPayload = {
  fonts: [
    { id: 'roboto', label: 'Roboto', family: 'Roboto', stack: "'Roboto', sans-serif", category: 'sans', weights: [100, 300, 400, 500, 700, 900] },
    { id: 'arimo', label: 'Arimo', family: 'Arimo', stack: "'Arimo', sans-serif", category: 'sans', weights: [400, 500, 600, 700] },
    { id: 'great_vibes', label: 'Great Vibes', family: 'Great Vibes', stack: "'Great Vibes', cursive", category: 'script', weights: [400] },
    { id: 'kaushan_script', label: 'Kaushan Script', family: 'Kaushan Script', stack: "'Kaushan Script', cursive", category: 'script', weights: [400] }
  ],
  clock: ['roboto', 'arimo'],
  weekday: ['great_vibes', 'kaushan_script'],
  date: ['roboto', 'arimo', 'great_vibes', 'kaushan_script'],
  stylesheet: 'https://fonts.googleapis.com/css2?family=Roboto:wght@100;300;400;500;700;900&display=swap',
  clock_size: [120, 260],
  secondary_size: [40, 200]
}

function installFetchStub() {
  const calls = []

  const stub = vi.fn(async (url, options = {}) => {
    calls.push({ url, options })
    const token = options.headers?.['X-Idleview-Token']

    if (url.includes('/api/auth/check')) {
      return token === VALID_TOKEN
        ? { ok: true, status: 200, json: async () => ({ ok: true }) }
        : { ok: false, status: 401, json: async () => ({ error: 'Missing or invalid control token' }) }
    }
    if (url.includes('/api/fonts')) {
      return { ok: true, status: 200, json: async () => fontsPayload }
    }
    if (url.includes('/api/settings')) {
      return { ok: true, status: 200, json: async () => settingsPayload }
    }
    if (url.includes('/api/photo/current')) {
      return { ok: true, status: 200, json: async () => null }
    }
    return { ok: true, status: 200, json: async () => ({}) }
  })

  globalThis.fetch = stub
  return { stub, calls }
}

const mountPaired = async () => {
  localStorage.setItem('idleviewControlToken', VALID_TOKEN)
  const context = installFetchStub()
  const wrapper = mount(App)
  await flushPromises()
  return { wrapper, ...context }
}

beforeEach(() => {
  localStorage.clear()
  sessionStorage.clear()
  // EventSource is not implemented in jsdom.
  globalThis.EventSource = class {
    close() {}
  }
})

describe('pairing gate', () => {
  it('shows the token prompt and no settings when unpaired', async () => {
    installFetchStub()

    const wrapper = mount(App)
    await flushPromises()

    expect(wrapper.text()).toContain('Pair with your screen')
    expect(wrapper.find('.pairing-form').exists()).toBe(true)

    // The whole settings surface must be absent, not merely hidden.
    expect(wrapper.find('main').exists()).toBe(false)
    expect(wrapper.text()).not.toContain('Temperature Unit')
    expect(wrapper.text()).not.toContain('Photo Quality')
  })

  it('never asks the user for an Unsplash key', async () => {
    const { wrapper } = await mountPaired()

    // Photos come from the proxy, which holds the key server-side. A key the user has to
    // supply - or that the app could hold at all - is the thing this design removes.
    expect(wrapper.text()).not.toContain('Unsplash Access Key')
    expect(wrapper.find('input[type="password"]').exists()).toBe(false)
  })

  it('never even fetches settings while unpaired', async () => {
    const { calls } = installFetchStub()

    mount(App)
    await flushPromises()

    // Reads are open server-side, so this ordering is what keeps settings off screen.
    expect(calls.some(call => call.url.includes('/api/settings'))).toBe(false)
  })

  it('rejects a wrong token and stays on the prompt', async () => {
    installFetchStub()

    const wrapper = mount(App)
    await flushPromises()

    await wrapper.find('.pairing-input').setValue('WRONGTOK')
    await wrapper.find('.pairing-form').trigger('submit')
    await flushPromises()

    expect(wrapper.find('main').exists()).toBe(false)
    expect(wrapper.text()).toContain('rejected')
    expect(localStorage.getItem('idleviewControlToken')).toBeNull()
  })

  it('reveals the settings once a valid token is entered', async () => {
    installFetchStub()

    const wrapper = mount(App)
    await flushPromises()
    expect(wrapper.find('main').exists()).toBe(false)

    await wrapper.find('.pairing-input').setValue(VALID_TOKEN)
    await wrapper.find('.pairing-form').trigger('submit')
    await flushPromises()

    expect(wrapper.find('main').exists()).toBe(true)
    expect(wrapper.text()).toContain('Temperature Unit')
    expect(wrapper.find('.pairing-form').exists()).toBe(false)
    expect(localStorage.getItem('idleviewControlToken')).toBe(VALID_TOKEN)
  })

  it('goes straight to the settings when a stored token is still good', async () => {
    localStorage.setItem('idleviewControlToken', VALID_TOKEN)
    installFetchStub()

    const wrapper = mount(App)
    await flushPromises()

    expect(wrapper.find('main').exists()).toBe(true)
    expect(wrapper.find('.pairing-form').exists()).toBe(false)
  })

  it('falls back to the prompt when a stored token has stopped working', async () => {
    localStorage.setItem('idleviewControlToken', 'STALETOK')
    const { calls } = installFetchStub()

    const wrapper = mount(App)
    await flushPromises()

    expect(wrapper.find('.pairing-form').exists()).toBe(true)
    expect(wrapper.find('main').exists()).toBe(false)
    expect(calls.some(call => call.url.includes('/api/settings'))).toBe(false)
  })

  it('lowercase input is accepted - the token is displayed in caps', async () => {
    installFetchStub()

    const wrapper = mount(App)
    await flushPromises()

    await wrapper.find('.pairing-input').setValue(VALID_TOKEN.toLowerCase())
    await wrapper.find('.pairing-form').trigger('submit')
    await flushPromises()

    expect(wrapper.find('main').exists()).toBe(true)
  })
})

describe('fonts come from the catalogue', () => {
  it('offers only the weights the selected font actually has', async () => {
    const { wrapper } = await mountPaired()

    // Roboto publishes six weights.
    expect(wrapper.vm.clockWeightOptions.map(o => o.value))
      .toEqual(['100', '300', '400', '500', '700', '900'])

    // Arimo has nothing below 400 - the old UI offered it "Thin" anyway.
    wrapper.vm.settings.clockFont = 'arimo'
    await flushPromises()
    expect(wrapper.vm.clockWeightOptions.map(o => o.value)).toEqual(['400', '500', '600', '700'])
    expect(wrapper.vm.clockWeightOptions.some(o => o.label.includes('Thin'))).toBe(false)

    // A script face with a single weight collapses to one option rather than
    // pretending to offer six.
    expect(wrapper.vm.weekdayWeightOptions.map(o => o.value)).toEqual(['400'])
  })

  it('snaps a stranded weight when the font changes', async () => {
    const { wrapper } = await mountPaired()

    wrapper.vm.settings.clockFontWeight = '100'
    await flushPromises()

    // Arimo has no 100. Rather than silently synthesising it, the control moves to the
    // nearest weight the face really ships.
    wrapper.vm.settings.clockFont = 'arimo'
    await flushPromises()

    expect(wrapper.vm.settings.clockFontWeight).toBe('400')
  })

  it('never offers a font the screen would not render', async () => {
    const { wrapper } = await mountPaired()

    const clockIds = wrapper.vm.clockFonts.map(f => f.id)
    // google_sans is not on Google Fonts at all; it used to be in this list.
    expect(clockIds).not.toContain('google_sans')
    // The clock takes sans faces only - a 180px script clock is unreadable.
    expect(clockIds).not.toContain('great_vibes')
    expect(wrapper.vm.weekdayFonts.every(f => f.category === 'script')).toBe(true)
  })

  it('takes its size bounds from the backend, not a local copy', async () => {
    const { wrapper } = await mountPaired()

    // The dashboard used to cap weekday/date at 120 while this panel accepted 200.
    expect(wrapper.vm.SECONDARY_FONT_SIZE_MAX).toBe(200)
    expect(wrapper.vm.CLOCK_FONT_SIZE_MAX).toBe(260)
  })
})

describe('writes carry the token', () => {
  it('sends the token and a client id on save', async () => {
    localStorage.setItem('idleviewControlToken', VALID_TOKEN)
    const { calls } = installFetchStub()

    const wrapper = mount(App)
    await flushPromises()

    // Toggling any setting queues the single debounced writer.
    vi.useFakeTimers()
    wrapper.vm.settings.showClock = false
    await flushPromises()
    vi.advanceTimersByTime(400)
    vi.useRealTimers()
    await flushPromises()

    const write = calls.find(call => call.options?.method === 'PATCH')
    expect(write).toBeTruthy()
    expect(write.options.headers['X-Idleview-Token']).toBe(VALID_TOKEN)
    expect(write.options.headers['X-Idleview-Client']).toMatch(/^panel-/)

    // One writer: the custom query rides along in the same request rather than a
    // second, racing one.
    const body = JSON.parse(write.options.body)
    expect(body.photos).toHaveProperty('custom_query')
    expect(typeof body.photos.photo_quality).toBe('number')

    // Weights go over the wire as numbers now, not "thin"/"regular"/"medium".
    expect(typeof body.display.clock_font_weight).toBe('number')
    expect(body.display.clock_font_weight).toBe(400)
  })
})
