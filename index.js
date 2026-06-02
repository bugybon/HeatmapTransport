const express = require('express');
const app = express();
const path = require('path');
const port = 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public'))); // serves index.html + assets

app.listen(port, () => {
  console.log(`Example app listening on port ${port}`);
});