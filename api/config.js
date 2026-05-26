export default function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const demoMode = process.env.DEMO_MODE === 'true' || !process.env.BLOB_READ_WRITE_TOKEN;
  return res.status(200).json({
    publicApiKey: process.env.PUBLIC_API_KEY || null,
    demoMode,
    blobToken: !!process.env.BLOB_READ_WRITE_TOKEN,
    anthropicKey: !!process.env.ANTHROPIC_API_KEY,
  });
}
