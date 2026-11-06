import { exec } from 'child_process';
import pino from 'pino';

const logger = pino({ name: 'email' });

export interface EmailParams {
  to: string;
  subject: string;
  html: string;
  text?: string;
}

export async function sendEmail(params: EmailParams): Promise<void> {
  try {
    const scriptPath = '/app/send_email_smtp.js';
    const command = `node "${scriptPath}" "${params.to}" "${params.subject}" "${params.html.replace(/"/g, '\\"')}"`;
    
    exec(command, (err, stdout, stderr) => {
      if (err) {
        logger.error({ err: err.message, stderr }, 'SMTP_EMAIL_ERROR');
      } else {
        logger.info({ stdout: stdout.trim() }, 'SMTP_EMAIL_SUCCESS');
      }
    });
  } catch (e) {
    logger.error({ err: (e as Error).message }, 'SMTP_EXEC_EXCEPTION');
  }
}

export async function sendRecoveryEmail(
  email: string,
  resetCode: string,
  userName: string
): Promise<void> {
  const subject = 'ATLAS - Código de recuperación de contraseña';
  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
      <h2 style="color: #103268;">Recuperación de contraseña - ATLAS</h2>
      <p>Hola ${userName},</p>
      <p>Has solicitado recuperar tu contraseña. Tu código de recuperación es:</p>
      <div style="background: #f4f6fa; border: 1px solid #e3e9f1; border-radius: 8px; padding: 20px; text-align: center; margin: 20px 0;">
        <span style="font-size: 24px; font-weight: bold; color: #103268; letter-spacing: 4px;">${resetCode}</span>
      </div>
      <p>Este código expira en 30 minutos.</p>
      <p>Si no solicitaste esto, ignora este correo.</p>
      <hr style="border-color: #e3e9f1;">
      <p style="font-size: 12px; color: #8194AB;">ATLAS - SAP Operations Suite | EAS Consulting</p>
    </div>
  `;

  await sendEmail({ to: email, subject, html });
}

export async function triggerN8nWebhook(
  email: string,
  code: string,
  nombre: string
): Promise<void> {
  try {
    const response = await fetch('http://10.10.10.103:5678/webhook/atlas-recover-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, code, nombre }),
    });
    if (!response.ok) {
      logger.warn({ status: response.status }, 'N8N_RECOVER_WEBHOOK_WARN');
    }
  } catch (e) {
    logger.warn({ err: (e as Error).message }, 'N8N_RECOVER_WEBHOOK_WARN');
  }
}