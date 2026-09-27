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

describe('pairing by QR code', () => {
  it('pairs from the #token in the link, then removes it from the address bar', async () => {
    history.replaceState(null, '', `/#token=${VALID_TOKEN.toLowerCase()}`)
    installFetchStub()

    // The token is read when the component module sets up, so mount afresh.
    vi.resetModules()
    const { default: FreshApp } = await import('./App.vue')
    const wrapper = mount(FreshApp)
    await flushPromises()

    expect(wrapper.find('main').exists()).toBe(true)
    expect(localStorage.getItem('idleviewControlToken')).toBe(VALID_TOKEN)
    expect(location.hash).toBe('')
  })

  it('falls back to the prompt when the QR code is out of date', async () => {
    history.replaceState(null, '', '/#token=OLDTOKEN')
    installFetchStub()

    vi.resetModules()
    const { default: FreshApp } = await import('./App.vue')
    const wrapper = mount(FreshApp)
    await flushPromises()

    expect(wrapper.find('.pairing-form').exists()).toBe(true)
    expect(wrapper.text()).toContain('out of date')
    expect(localStorage.getItem('idleviewControlToken')).toBeNull()
    expect(location.hash).toBe('')
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

describe('sections', () => {
  it('open and close natively, and start open', async () => {
    const { wrapper } = await mountPaired()

    const sections = wrapper.findAll('main details')
    expect(sections.map(s => s.find('summary').text())).toEqual(['Units', 'Show on screen', 'Photos'])
    expect(sections.every(s => s.element.open)).toBe(true)
  })

  it('remembers which sections were closed', async () => {
    const { wrapper } = await mountPaired()
    const units = wrapper.find('main details')
    units.element.open = false
    await units.trigger('toggle')
    expect(JSON.parse(localStorage.getItem('expandedSections')).units).toBe(false)
    wrapper.unmount()

    // Next visit: Units stays closed, the others open.
    const { wrapper: again } = await mountPaired()
    const sections = again.findAll('main details').map(d => d.element.open)
    expect(sections).toEqual([false, true, true])
  })

  it('has no way to ask the screen for a photo on demand', async () => {
    const { wrapper } = await mountPaired()
    expect(wrapper.text()).not.toMatch(/new photo now/i)
  })
})

describe('save confirmation', () => {
  it('says the screen is updated once a change is saved', async () => {
    const { wrapper } = await mountPaired()

    vi.useFakeTimers()
    wrapper.vm.settings.display.show_clock = false
    await flushPromises()
    vi.advanceTimersByTime(400)
    vi.useRealTimers()
    await flushPromises()

    const notice = wrapper.find('.notice')
    expect(notice.attributes('role')).toBe('status')
    expect(notice.text()).toContain('Saved')
    expect(notice.text()).toContain('screen is updated')
  })
})

describe('my photos', () => {
  const mountLocal = async (ids) => {
    localStorage.setItem('idleviewControlToken', VALID_TOKEN)
    globalThis.URL.createObjectURL = vi.fn(() => 'blob:thumb')
    globalThis.URL.revokeObjectURL = vi.fn()
    const calls = []
    globalThis.fetch = vi.fn(async (url, options = {}) => {
      calls.push({ url, options })
      if (url.includes('/api/auth/check')) return { ok: true, status: 200, json: async () => ({ ok: true }) }
      if (url.includes('/api/settings') && !options.method) {
        const settings = settingsPayload()
        settings.photos.source = 'local'
        return { ok: true, status: 200, json: async () => settings }
      }
      if (url.endsWith('/thumb')) return { ok: true, status: 200, blob: async () => new Blob(['x']) }
      if (url === '/api/photos' && !options.method) return { ok: true, status: 200, json: async () => ids }
      if (url === '/api/photos' && options.method === 'POST') return { ok: true, status: 200, json: async () => ({ id: 'ffffffffffffffff' }) }
      return { ok: true, status: 200, json: async () => null }
    })
    const wrapper = mount(App)
    await flushPromises()
    return { wrapper, calls }
  }

  it('says the screen stays dark rather than using Unsplash when there are none', async () => {
    const { wrapper } = await mountLocal([])
    expect(wrapper.text()).toContain('Unsplash is not')
    expect(wrapper.find('input[type="file"]').exists()).toBe(true)
    // Holiday photos are an Unsplash search; they do not apply here.
    expect(wrapper.text()).not.toContain('Holiday photos')
  })

  it('shows each photo, fetching thumbnails with the token', async () => {
    const { wrapper, calls } = await mountLocal(['0123456789abcdef', 'fedcba9876543210'])
    expect(wrapper.findAll('.grid img')).toHaveLength(2)

    const thumb = calls.find(call => call.url.endsWith('/thumb'))
    expect(thumb.options.headers['X-Idleview-Token']).toBe(VALID_TOKEN)
  })

  it('offers Next photo once there is more than one, and asks the screen with the token', async () => {
    const { wrapper: single } = await mountLocal(['0123456789abcdef'])
    expect(single.text()).not.toContain('Next photo')

    const { wrapper, calls } = await mountLocal(['0123456789abcdef', 'fedcba9876543210'])
    const next = wrapper.findAll('button').find(b => b.text() === 'Next photo')
    await next.trigger('click')
    await flushPromises()

    const request = calls.find(call => call.url === '/api/photos/next')
    expect(request.options.method).toBe('POST')
    expect(request.options.headers['X-Idleview-Token']).toBe(VALID_TOKEN)
  })

  it('uploads each chosen file as-is, with the token', async () => {
    const { wrapper, calls } = await mountLocal([])
    const file = new File(['jpeg bytes'], 'beach.jpg', { type: 'image/jpeg' })

    const input = wrapper.find('input[type="file"]')
    Object.defineProperty(input.element, 'files', { value: [file] })
    await input.trigger('change')
    await flushPromises()

    const upload = calls.find(call => call.options.method === 'POST')
    expect(upload.url).toBe('/api/photos')
    expect(upload.options.body).toBe(file)
    expect(upload.options.headers['Content-Type']).toBe('image/jpeg')
    expect(upload.options.headers['X-Idleview-Token']).toBe(VALID_TOKEN)
    expect(wrapper.find('.notice').text()).toContain('Photo added')
  })
})

describe('confirmation dialog', () => {
  // jsdom has <dialog> but not its modal methods.
  beforeEach(() => {
    HTMLDialogElement.prototype.showModal = function () { this.open = true }
    HTMLDialogElement.prototype.close = function () { this.open = false; this.dispatchEvent(new Event('close')) }
  })

  it('removes a photo only after Remove is pressed in the styled dialog', async () => {
    localStorage.setItem('idleviewControlToken', VALID_TOKEN)
    globalThis.URL.createObjectURL = vi.fn(() => 'blob:thumb')
    globalThis.URL.revokeObjectURL = vi.fn()
    const calls = []
    globalThis.fetch = vi.fn(async (url, options = {}) => {
      calls.push({ url, options })
      if (url.includes('/api/auth/check')) return { ok: true, status: 200, json: async () => ({ ok: true }) }
      if (url.includes('/api/settings')) {
        const settings = settingsPayload()
        settings.photos.source = 'local'
        return { ok: true, status: 200, json: async () => settings }
      }
      if (url.endsWith('/thumb')) return { ok: true, status: 200, blob: async () => new Blob(['x']) }
      if (url === '/api/photos') return { ok: true, status: 200, json: async () => ['0123456789abcdef'] }
      return { ok: true, status: 200, json: async () => ({ ok: true }) }
    })
    const wrapper = mount(App, { attachTo: document.body })
    await flushPromises()
    const deletes = () => calls.filter(call => call.options.method === 'DELETE')

    // Cancel: nothing is deleted.
    await wrapper.find('.remove').trigger('click')
    const dialog = wrapper.find('dialog.confirm')
    expect(dialog.element.open).toBe(true)
    expect(dialog.text()).toContain('Remove this photo')
    expect(dialog.find('img').attributes('src')).toBe('blob:thumb')
    await dialog.findAll('button').find(b => b.text() === 'Cancel').trigger('click')
    await flushPromises()
    expect(dialog.element.open).toBe(false)
    expect(deletes()).toHaveLength(0)

    // Remove: exactly one delete, of that photo.
    await wrapper.find('.remove').trigger('click')
    await dialog.findAll('button').find(b => b.text() === 'Remove').trigger('click')
    await flushPromises()
    expect(deletes().map(call => call.url)).toEqual(['/api/photos/0123456789abcdef'])
    wrapper.unmount()
  })
})
