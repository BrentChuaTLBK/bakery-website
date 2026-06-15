module.exports = {
  content: ['*.html', 'assets/js/*.js'],
  css: ['assets/bootstrap/css/bootstrap.min.css'],
  safelist: [
    /modal/, /fade/, /show/, /carousel/, /active/, /collaps/, /dropdown/, 
    /nav/, /navbar/, /tooltip/, /popover/, /bs-/, /btn/, /bg-/, /text-/,
    /shadow/, /border/, /rounded/, /m-/, /p-/, /d-/, /align-/, /justify-/
  ],
  output: 'assets/bootstrap/css/bootstrap.min.css'
}
