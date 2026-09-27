import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import App from './App.vue'

// The panel talks to the Idleview app over fetch and SSE. Neither exists in jsdom, so
// both are stubbed and the responses are scripted per test.
const VALID_TOKEN = 'K7PMX2QD'

// The shape GET /api/settings returns.
const settingsPayload = () => ({
  units: { temperature_unit: 'celsius', time_format: '24h', date_format: 'dmy', wind_speed_unit: 'kmh' },
  display: {
    show_clock: true, show_date: true, show_weekday: true, show_location: true,
    show_temperature: true, show_sunrise_sunset: true,
    show_precipitation_cloudiness: true, show_humidity_wind: true
  },
  photos: { refresh_interval: 30, enable_festive_queries: true }
})

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
    if (url.includes('/api/settings')) {
      return { ok: true, status: 200, json: async () => settingsPayload() }
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
    expect(wrapper.text()).not.toContain('Temperature')
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
    expect(wrapper.text()).toContain('Temperature')
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

describe('writes carry the token', () => {
  it('sends the token and a client id on save', async () => {
    localStorage.setItem('idleviewControlToken', VALID_TOKEN)
    const { calls } = installFetchStub()

    const wrapper = mount(App)
    await flushPromises()

    // Toggling any setting queues the single debounced writer.
    vi.useFakeTimers()
    wrapper.vm.settings.display.show_clock = false
    await flushPromises()
    vi.advanceTimersByTime(400)
    vi.useRealTimers()
    await flushPromises()

    const write = calls.find(call => call.options?.method === 'PATCH')
    expect(write).toBeTruthy()
    expect(write.options.headers['X-Idleview-Token']).toBe(VALID_TOKEN)
    expect(write.options.headers['X-Idleview-Client']).toMatch(/^panel-/)

    // The body is the settings as the backend shapes them, with the change applied.
    const body = JSON.parse(write.options.body)
    expect(body.display.show_clock).toBe(false)
    expect(body.photos.refresh_interval).toBe(30)
  })

  it('does not save the state it just loaded', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const { calls } = await mountPaired()
    vi.advanceTimersByTime(1000)
    vi.useRealTimers()
    await flushPromises()

    expect(calls.some(call => call.options?.method === 'PATCH')).toBe(false)
  })
})

describe('choices', () => {
  it('saves the option that was tapped', async () => {
    const { wrapper, calls } = await mountPaired()

    vi.useFakeTimers()
    const twelveHour = wrapper.findAll('button[role="radio"]').find(b => b.text() === '2:30 PM')
    await twelveHour.trigger('click')
    vi.advanceTimersByTime(400)
    vi.useRealTimers()
    await flushPromises()

    expect(twelveHour.attributes('aria-checked')).toBe('true')
    const body = JSON.parse(calls.find(call => call.options?.method === 'PATCH').options.body)
    expect(body.units.time_format).toBe('12h')
  })
})
