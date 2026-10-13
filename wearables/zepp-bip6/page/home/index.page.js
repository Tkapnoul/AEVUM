import { BasePage } from '@zeppos/zml/base-page'
import { createWidget, widget, align, prop, text_style } from '@zos/ui'
import { px } from '@zos/utils'
import { setPageBrightTime } from '@zos/display'
import { collect } from '../../shared/collect'

const GOLD = 0xc9a86a
const INK = 0xf0eadc
const MUTED = 0x8d887b

Page(
  BasePage({
    state: { syncing: false },

    build() {
      // Keep the screen on while syncing; BLE transfer to the phone takes a few seconds.
      setPageBrightTime({ brightTime: 60000 })

      createWidget(widget.TEXT, {
        x: px(0), y: px(70), w: px(480), h: px(60),
        text: 'AEVUM', text_size: px(40), color: GOLD,
        align_h: align.CENTER_H, align_v: align.CENTER_V,
      })
      this.status = createWidget(widget.TEXT, {
        x: px(40), y: px(150), w: px(400), h: px(150),
        text: '', text_size: px(26), color: INK,
        align_h: align.CENTER_H, align_v: align.CENTER_V, text_style: text_style.WRAP,
      })
      this.detail = createWidget(widget.TEXT, {
        x: px(40), y: px(300), w: px(400), h: px(50),
        text: '', text_size: px(20), color: MUTED,
        align_h: align.CENTER_H, align_v: align.CENTER_V,
      })
      createWidget(widget.BUTTON, {
        x: px(90), y: px(370), w: px(300), h: px(72), radius: px(36),
        normal_color: GOLD, press_color: 0xa8834a, color: 0x16170f,
        text: 'Sync', text_size: px(28),
        click_func: () => this.sync(),
      })
    },

    onInit() {
      // Sync straight away: opening the app is the member's "sync now".
      setTimeout(() => this.sync(), 300)
    },

    setText(main, sub) {
      this.status && this.status.setProperty(prop.MORE, { text: main })
      this.detail && this.detail.setProperty(prop.MORE, { text: sub || '' })
    },

    sync() {
      if (this.state.syncing) return
      this.state.syncing = true
      this.setText('Reading data…')
      let payload
      try {
        payload = collect()
      } catch (e) {
        this.state.syncing = false
        this.setText('Could not read data', String(e))
        return
      }
      this.setText('Syncing…', 'Keep your phone nearby')
      this.request({ method: 'aevum.sync', params: payload })
        .then((res) => {
          if (res && res.ok) {
            const n = res.stored || 0
            this.setText('Synced ✓', n + ' values · ' + new Date().toTimeString().slice(0, 5))
          } else if (res && res.error === 'not_paired') {
            this.setText('Not paired', 'Zepp app › AEVUM › Settings')
          } else {
            this.setText('Sync failed', (res && res.error) || 'Try again')
          }
        })
        .catch(() => this.setText('Phone not reachable', 'Open the Zepp app'))
        .finally(() => {
          this.state.syncing = false
        })
    },
  }),
)
