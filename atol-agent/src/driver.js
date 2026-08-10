// Обёртка над node-atol-wrapper (нативный биндинг к официальному драйверу
// АТОЛ ДТО10, libfptr10). Пакет уже содержит нужные бинарники под
// Windows/Linux/macOS (x64/x86/arm64/armhf) — отдельно устанавливать
// "Драйвер ККТ 10" с сайта АТОЛ не требуется.
//
// Известные модели (код для поля Model, см. bindings.d.ts пакета):
//   АТОЛ 11Ф = 67, АТОЛ 25Ф = 57, АТОЛ 30Ф = 61
// Канал обмена (поле Port): TCP/IP = 2 (COM=0, USB=1, TCPIP=2, Bluetooth=3).
import atolPkg from 'node-atol-wrapper';

const { Fptr10 } = atolPkg;

const PORT_TCPIP = 2;

export class AtolDriver {
  constructor({ ip, port, model }) {
    this.ip = ip;
    this.port = Number(port) || 5555;
    this.model = model ? Number(model) : undefined;
    this.fptr = null;
  }

  connect() {
    if (this.fptr) return;
    if (!this.ip) throw new Error('KKT_IP не задан в .env агента');

    const fptr = new Fptr10();
    fptr.create();

    const settings = fptr.getSettings();
    settings.Port = PORT_TCPIP;
    settings.IPAddress = this.ip;
    settings.IPPort = this.port;
    if (this.model) settings.Model = this.model;
    fptr.setSettings(settings);

    fptr.open();
    this.fptr = fptr;
  }

  disconnect() {
    if (!this.fptr) return;
    try {
      this.fptr.close();
      this.fptr.destroy();
    } catch {
      // Кассу может быть уже отключили физически — не мешаем остановке агента
    } finally {
      this.fptr = null;
    }
  }

  // Выполнить JSON-задание (openShift/closeShift/sell/reportX и т.д.), см.
  // ../../backoffice/src/services/fiscalQueue.js за описанием задач, которые
  // складывает backend. Переподключается автоматически, если связь была
  // разорвана предыдущим заданием.
  runTask(task) {
    try {
      this.connect();
    } catch (err) {
      this.disconnect();
      throw err;
    }

    try {
      return this.fptr.processJson(task);
    } catch (err) {
      // "Нет связи"/"Порт недоступен" и похожие — обрываем соединение, чтобы
      // следующее задание переподключилось с нуля, а не билось в мёртвый сокет
      if (err && (err.code === 2 || err.code === 4)) {
        this.disconnect();
      }
      throw err;
    }
  }
}
