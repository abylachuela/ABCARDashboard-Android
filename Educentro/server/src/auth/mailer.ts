import nodemailer from 'nodemailer';
import type { Config } from '../config.js';

export interface Mailer {
  enviarRecuperacion(destino: string, nombre: string, enlace: string, caducaMin: number): Promise<void>;
}

/** Desarrollo: imprime el enlace por consola. Se niega a existir en producción. */
export class MailerConsola implements Mailer {
  constructor(produccion: boolean) {
    if (produccion) throw new Error('El transporte de correo "consola" no está permitido en producción');
  }
  async enviarRecuperacion(destino: string, _nombre: string, enlace: string, caducaMin: number): Promise<void> {
    console.log(`[correo:consola] Recuperación para ${destino} (caduca en ${caducaMin} min): ${enlace}`);
  }
}

export class MailerSmtp implements Mailer {
  private readonly transporte;
  constructor(private readonly cfg: Config) {
    const s = cfg.correo.smtp;
    if (!s) throw new Error('Falta la configuración SMTP');
    this.transporte = nodemailer.createTransport({
      host: s.host,
      port: s.port,
      secure: s.secure,
      requireTLS: !s.secure,
      ...(s.user ? { auth: { user: s.user, pass: s.pass ?? '' } } : {}),
      connectionTimeout: 10_000,
      socketTimeout: 15_000,
    });
  }
  async enviarRecuperacion(destino: string, nombre: string, enlace: string, caducaMin: number): Promise<void> {
    await this.transporte.sendMail({
      from: this.cfg.correo.from,
      to: destino,
      subject: 'EduCentro: restablecer contraseña',
      text:
        `Hola ${nombre.replace(/[\r\n]+/g, ' ')},\n\n` +
        `Recibimos una solicitud para restablecer tu contraseña de EduCentro. ` +
        `Abre este enlace (válido ${caducaMin} minutos y de un solo uso):\n\n${enlace}\n\n` +
        `Si no lo solicitaste, ignora este mensaje: tu contraseña no cambiará.`,
    });
  }
}

export function crearMailer(cfg: Config): Mailer {
  return cfg.correo.transporte === 'smtp' ? new MailerSmtp(cfg) : new MailerConsola(cfg.produccion);
}
