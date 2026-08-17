# ProfConnect — Raspberry Pi professor office kiosk

A complete Python/Flask MVP for a Raspberry Pi office display. It provides a full-screen kiosk, live status polling, QR-based mobile appointment booking, office-hour slots, and a professor dashboard.

## What is included

- `app.py`: Flask backend, SQLite database, APIs, QR generation, booking logic, dashboard
- `templates/`: kiosk, booking, login, confirmation, and dashboard interfaces
- `static/style.css`: touch-friendly responsive UI
- `profconnect.service`: optional production systemd service
- `kiosk.sh`: Chromium loop for the Raspberry Pi display

## 1. Local development setup

Prerequisites: Python 3.10+.

```bash
unzip profconnect.zip
cd profconnect
python -m venv .venv
```

Windows:

```powershell
.\.venv\Scripts\Activate.ps1
```

Linux/macOS/Raspberry Pi:

```bash
source .venv/bin/activate
```

Install packages and configure environment:

```bash
pip install -r requirements.txt
cp .env.example .env
```

On Windows copy `.env.example` to `.env` manually. Edit `.env` before deploying: set a long random `SECRET_KEY`, an admin email, and a strong password.

Initialize sample professor and hours:

```bash
flask --app app seed
flask --app app run --host 0.0.0.0 --port 5000
```

Open these URLs:

- Kiosk: `http://localhost:5000/kiosk/dr-ananya-sharma`
- Professor dashboard: `http://localhost:5000/login`
- Booking page: `http://localhost:5000/p/dr-ananya-sharma/book`

Default development login is `professor@college.edu` / `ChangeMe123!`. Change both values in `.env` before any real deployment.

## 2. Use the application

1. Login to the dashboard.
2. Change presence to **IN OFFICE**, **BUSY**, **AWAY**, or **UNAVAILABLE** and optionally add a message.
3. Add recurring office hours; available appointment slots are generated from them.
4. Place the kiosk URL on the Raspberry Pi display.
5. Students scan the QR code or tap booking, select an open slot, and submit their details.
6. The kiosk refreshes its state every 30 seconds. Refresh the display page manually if you want an immediate update during testing.

## 3. Raspberry Pi installation

Use Raspberry Pi OS Desktop and connect the display. Update the system:

```bash
sudo apt update && sudo apt upgrade -y
sudo apt install -y python3-venv chromium-browser
```

Copy the project directory to `/home/pi/profconnect`, then run the local setup commands above there. Start the service:

```bash
sudo cp profconnect.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now profconnect
sudo systemctl status profconnect
```

Test from Chromium: `http://localhost:5000/kiosk/dr-ananya-sharma`.

For kiosk launch, make the script executable:

```bash
chmod +x kiosk.sh
```

Add this command to your desktop session auto-start (the location varies by Raspberry Pi OS version):

```bash
/home/pi/profconnect/kiosk.sh
```

The script relaunches Chromium if it is closed. Set display sleep/blanking off in Raspberry Pi settings for an always-on office display.

## 4. Network deployment

For a real installation, host Flask behind Nginx with HTTPS or deploy it to a server. Set `BASE_URL` to the public HTTPS domain, such as `https://profconnect.yourcollege.edu`, then restart the service. The QR code will automatically encode that public booking URL.

The bundled app uses SQLite for the MVP. Before multiple professors and concurrent high traffic, switch `DATABASE_URL` to PostgreSQL, for example:

```env
DATABASE_URL=postgresql+psycopg://user:password@host:5432/profconnect
```

Then install a PostgreSQL driver and use Alembic/Flask-Migrate for schema migrations.

## Security before production

- Use HTTPS and a reverse proxy.
- Replace the single environment-password login with college SSO or real user accounts with hashed passwords.
- Add CSRF protection, email verification/OTP, rate limiting, and CAPTCHA for public bookings.
- Never display appointment or student data on the public kiosk.
- Back up the database and use PostgreSQL for multi-user production usage.
- Keep `.env` private; never commit it to Git.

## Customization

Edit the seeded professor in `app.py` or use the database. The app currently supports one dashboard identity as a working MVP; add a `User` model and role-based access for a college-wide deployment.
