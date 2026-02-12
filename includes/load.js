fetch('./includes/header.html')
  .then(r => r.text())
  .then(d => document.getElementById('header').innerHTML = d);

fetch('./includes/footer.html')
  .then(r => r.text())
  .then(d => document.getElementById('footer').innerHTML = d);