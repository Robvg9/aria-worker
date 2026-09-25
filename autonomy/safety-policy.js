// SAFETY-1790353658: do not write
// Esta política prohíbe explícitamente las operaciones de escritura en el sistema de archivos.
const FORBIDDEN_WRITE_OPERATIONS = [
  'fs.writeFile',
  'fs.writeFileSync',
  'fs.promises.writeFile',
  'fs.appendFile',
  'fs.appendFileSync',
  'fs.promises.appendFile'
];

function checkWriteSafety(operation) {
  if (FORBIDDEN_WRITE_OPERATIONS.includes(operation)) {
    throw new Error(`Operación de escritura prohibida detectada: ${operation}`);
  }
}

module.exports = { checkWriteSafety };
