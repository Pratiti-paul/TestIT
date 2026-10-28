export const getHealth = (req, res) => {
  res.status(200).json({
    success: true,
    message: 'TestIT backend is running',
    service: 'TestIT API'
  });
};

