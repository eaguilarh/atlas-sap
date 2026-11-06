import { describe, it, expect, vi } from 'vitest';
import { signupSchema, loginSchema, rfcsInsertSchema, solicitudesInsertSchema, sistemasInsertSchema } from '../middleware/validation.js';

describe('Validation schemas', () => {
  describe('signupSchema', () => {
    it('validates correct signup data', () => {
      const data = {
        email: 'test@test.com',
        password: 'password123',
        options: { data: { nombre: 'Test User', rol: 'fte' } },
      };
      const result = signupSchema.safeParse(data);
      expect(result.success).toBe(true);
    });

    it('rejects invalid email', () => {
      const data = { email: 'invalid', password: 'password123' };
      const result = signupSchema.safeParse(data);
      expect(result.success).toBe(false);
    });

    it('rejects short password', () => {
      const data = { email: 'test@test.com', password: '123' };
      const result = signupSchema.safeParse(data);
      expect(result.success).toBe(false);
    });
  });

  describe('loginSchema', () => {
    it('validates correct login data', () => {
      const data = { email: 'test@test.com', password: 'password123' };
      const result = loginSchema.safeParse(data);
      expect(result.success).toBe(true);
    });

    it('rejects missing fields', () => {
      const data = { email: 'test@test.com' };
      const result = loginSchema.safeParse(data);
      expect(result.success).toBe(false);
    });
  });

  describe('rfcsInsertSchema', () => {
    it('validates correct RFC data', () => {
      const data = {
        ticket: 'RFC-001',
        tipo: 'Cambio',
        ambiente: 'Producción',
        fecha: '2024-01-15',
        sistema_name: 'SAP ERP',
        status: 'En espera de VOBO',
      };
      const result = rfcsInsertSchema.safeParse(data);
      expect(result.success).toBe(true);
    });

    it('requires ticket and fecha', () => {
      const data = { tipo: 'Cambio' };
      const result = rfcsInsertSchema.safeParse(data);
      expect(result.success).toBe(false);
    });
  });

  describe('solicitudesInsertSchema', () => {
    it('validates correct solicitud data', () => {
      const data = {
        tipo: 'Incidente',
        origen: 'DXC',
        fecha_inicio: '2024-01-15',
        sistema_sap: 'SAP ERP',
        responsable: 'Juan Pérez',
      };
      const result = solicitudesInsertSchema.safeParse(data);
      expect(result.success).toBe(true);
    });

    it('validates tipo enum', () => {
      const data = { tipo: 'Invalido', fecha_inicio: '2024-01-15' };
      const result = solicitudesInsertSchema.safeParse(data);
      expect(result.success).toBe(false);
    });
  });

  describe('sistemasInsertSchema', () => {
    it('validates correct sistema data', () => {
      const data = {
        nombre: 'SAP ERP',
        infraestructura: 'OnPremise',
        tipo_sap: 'SAP',
        criticidad: 1,
      };
      const result = sistemasInsertSchema.safeParse(data);
      expect(result.success).toBe(true);
    });

    it('validates criticidad range', () => {
      const data = { nombre: 'Test', criticidad: 5 };
      const result = sistemasInsertSchema.safeParse(data);
      expect(result.success).toBe(false);
    });
  });
});