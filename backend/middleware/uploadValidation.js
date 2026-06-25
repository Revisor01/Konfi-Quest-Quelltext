const fs = require('fs');

const validateMagicBytes = async (req, res, next) => {
  if (!req.file && !req.files) return next();
  const files = req.file ? [req.file] : (req.files || []);
  const { fileTypeFromBuffer } = await import('file-type');

  for (const file of files) {
    // Text-basierte Formate haben keine Magic Bytes — Header vertrauen
    const textMimes = ['text/plain', 'text/csv'];
    if (textMimes.includes(file.mimetype)) continue;

    const buffer = fs.readFileSync(file.path);
    const detected = await fileTypeFromBuffer(buffer);

    if (!detected) {
      fs.unlinkSync(file.path);
      return res.status(415).json({ error: 'Dateityp konnte nicht verifiziert werden' });
    }

    const allowedPrefixes = [
      'image/', 'video/', 'audio/', 'application/pdf',
      'application/vnd.openxmlformats', 'application/msword',
      'application/vnd.ms-excel', 'application/vnd.ms-powerpoint',
      'application/zip', 'application/x-cfb' // Office-Formate: ZIP (docx) oder CFB (doc/xls/ppt)
    ];
    const isAllowed = allowedPrefixes.some(p => detected.mime.startsWith(p));

    if (!isAllowed) {
      fs.unlinkSync(file.path);
      return res.status(415).json({ error: 'Dateityp nicht erlaubt: ' + detected.mime });
    }
  }
  next();
};

module.exports = { validateMagicBytes };
