import { Router } from 'express';

import { requiereAutenticacion } from '../../middlewares/auth.js';
import { requierePermiso } from '../../middlewares/permisos.js';
import { getAuditoria } from './controller.js';

export const auditoriaRouter: Router = Router();

// Solo el dueño. Es el registro de quién hizo qué: no es información que
// corresponda a un empleado ni a un encargado.
auditoriaRouter.get(
  '/auditoria',
  requiereAutenticacion,
  requierePermiso('auditoria:ver'),
  getAuditoria,
);
