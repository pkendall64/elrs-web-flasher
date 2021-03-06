import { TransportEx } from './serialex.js'
import { ESPLoader } from 'esptool-js/ESPLoader.js'
import { Passthrough } from './passthrough.js'
import CryptoJS from 'crypto-js'

class ESPFlasher {
  constructor (device, type, method, config, options, firmwareUrl, term) {
    this.device = device
    this.type = type
    this.method = method
    this.config = config
    this.options = options
    this.firmwareUrl = firmwareUrl
    this.term = term
  }

  connect = async () => {
    let mode = 'default_reset'
    let baudrate = 460800
    let initbaud
    if (this.method === 'betaflight') {
      baudrate = 420000
      mode = 'no_reset'
    } else if (this.method === 'etx') {
      baudrate = 230400
      mode = 'no_reset'
    } else if (this.method === 'uart' && this.type === 'TX') {
      initbaud = 115200
    }

    const transport = new TransportEx(this.device, true)
    this.esploader = new ESPLoader(transport, baudrate, this.term, initbaud === undefined ? baudrate : initbaud)
    this.esploader.ESP_RAM_BLOCK = 0x0800 // we override otherwise flashing on BF will fail

    const passthrough = new Passthrough(transport, this.term, this.config.firmware, baudrate)
    if (this.method === 'uart') {
      if (this.type === 'RX') {
        await transport.connect({ baud: baudrate })
          .then(_ => this.esploader._connect_attempt())
          .then(ret => {
            if (ret !== 'success') {
              return transport.disconnect()
                .then(_ => transport.connect({ baud: 420000 }))
                .then(_ => passthrough.reset_to_bootloader())
            }
          })
      } else {
        await transport.connect({ baud: 115200 })
      }
    } else if (this.method === 'betaflight') {
      await transport.connect({ baud: baudrate })
        .then(_ => passthrough.betaflight())
        .then(_ => passthrough.reset_to_bootloader())
    } else if (this.method === 'etx') {
      await transport.connect({ baud: baudrate })
        .then(_ => passthrough.edgeTX())
    }

    return transport.disconnect()
      .then(_ => this.esploader.main_fn({ mode }))
      .then(chip => {
        console.log('Settings done for :' + chip)
        return chip
      })
  }

  flash = async (files, erase) => {
    const loader = this.esploader
    if (this.method === 'etx' || this.method === 'betaflight') {
      loader.FLASH_WRITE_SIZE = 0x0800
    }

    const fileArray = files.map(v => ({ data: loader.ui8ToBstr(v.data), address: v.address }))
    return loader.write_flash({
      fileArray,
      flash_size: 'keep',
      erase_all: erase,
      reportProgress: (fileIndex, written, total) => {
        const percent = Math.round(written / total * 100)
        document.getElementById('progressBar').value = percent
        document.getElementById('status').innerHTML = `Flashing: ${percent}% uploaded... please wait`
      },
      calculateMD5Hash: (image) => CryptoJS.MD5(CryptoJS.enc.Latin1.parse(image))
    })
      .then(_ => {
        document.getElementById('progressBar').value = 100
        document.getElementById('status').innerHTML = 'Flashing complete'
        if (this.config.platform === 'esp32') {
          return loader.hard_reset().catch(() => {})
        } else {
          return loader.soft_reset().catch(() => {})
        }
      })
  }
}

export { ESPFlasher }
