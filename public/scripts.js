document.addEventListener('DOMContentLoaded', () => {
    // ---------------------------
    // Elements
    // ---------------------------
    const hamburgerMenu = document.getElementById('hamburger-menu');
    const sideMenu = document.getElementById('side-menu');
    const loginButton = document.querySelector('.login-btn');

    // ---------------------------
    // Hamburger menu toggle + spin
    // ---------------------------
    function spinHamburger(forward = true) {
        const spinClass = forward ? 'spin-forward' : 'spin-backward';
        hamburgerMenu.classList.add(spinClass);
        setTimeout(() => {
            hamburgerMenu.classList.remove('spin-forward', 'spin-backward');
        }, 600);
    }

    hamburgerMenu.addEventListener('click', (event) => {
        const opening = !sideMenu.classList.contains('active');
        sideMenu.classList.toggle('active');
        spinHamburger(opening);
        event.stopPropagation();
    });

    document.addEventListener('click', (event) => {
        if (!sideMenu.contains(event.target) && !hamburgerMenu.contains(event.target)) {
            if (sideMenu.classList.contains('active')) {
                sideMenu.classList.remove('active');
                spinHamburger(false);
            }
        }
    });

    // ---------------------------
    // Login button logic
    // ---------------------------
    fetch('/current-user') // endpoint returning { username: '...' } if logged in
        .then(res => res.json())
        .then(data => {
            if (data.username) {
                if (loginButton) {
                    loginButton.innerHTML = `
                        <img src="images/user_icon.png" alt="User" style="width:24px;height:24px;vertical-align:middle;margin-right:8px;">
                        ${data.username}
                    `;
                    loginButton.style.cursor = 'pointer';
loginButton.onclick = () => {
    window.location.href = 'UserInterface.html';
};
                }
            } else {
                if (loginButton) {
                    loginButton.addEventListener('click', (e) => {
                        e.preventDefault();
                        window.location.href = 'login.html';
                    });
                }
            }
        });
});
