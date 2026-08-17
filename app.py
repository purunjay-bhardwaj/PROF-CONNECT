import os
from datetime import datetime, date, time, timedelta
from functools import wraps
from io import BytesIO

import qrcode
from dotenv import load_dotenv
from flask import Flask, abort, flash, jsonify, redirect, render_template, request, send_file, session, url_for
from flask_sqlalchemy import SQLAlchemy
from sqlalchemy import and_

load_dotenv()
app = Flask(__name__)
app.config['SECRET_KEY'] = os.getenv('SECRET_KEY', 'development-only-change-me')
app.config['SQLALCHEMY_DATABASE_URI'] = os.getenv('DATABASE_URL', 'sqlite:///profconnect.db')
app.config['SQLALCHEMY_TRACK_MODIFICATIONS'] = False
db = SQLAlchemy(app)

class Professor(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    slug = db.Column(db.String(80), unique=True, nullable=False)
    name = db.Column(db.String(150), nullable=False)
    department = db.Column(db.String(150), nullable=False)
    designation = db.Column(db.String(100), nullable=False)
    office = db.Column(db.String(100), nullable=False)
    status = db.Column(db.String(20), nullable=False, default='AWAY')
    status_message = db.Column(db.String(180), nullable=False, default='')
    updated_at = db.Column(db.DateTime, nullable=False, default=datetime.utcnow)
    slot_minutes = db.Column(db.Integer, nullable=False, default=20)

class OfficeHour(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    professor_id = db.Column(db.Integer, db.ForeignKey('professor.id'), nullable=False)
    weekday = db.Column(db.Integer, nullable=False)
    start_time = db.Column(db.Time, nullable=False)
    end_time = db.Column(db.Time, nullable=False)
    enabled = db.Column(db.Boolean, nullable=False, default=True)

class Appointment(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    professor_id = db.Column(db.Integer, db.ForeignKey('professor.id'), nullable=False)
    student_name = db.Column(db.String(120), nullable=False)
    student_email = db.Column(db.String(150), nullable=False)
    student_id = db.Column(db.String(60), nullable=False)
    purpose = db.Column(db.String(300), nullable=False)
    starts_at = db.Column(db.DateTime, nullable=False)
    ends_at = db.Column(db.DateTime, nullable=False)
    status = db.Column(db.String(20), nullable=False, default='CONFIRMED')
    created_at = db.Column(db.DateTime, nullable=False, default=datetime.utcnow)

def professor_or_404(slug):
    professor = Professor.query.filter_by(slug=slug).first()
    if professor is None:
        abort(404)
    return professor

def presence_api_authorized():
    expected_key = os.getenv("PRESENCE_API_KEY")

    if not expected_key:
        return False

    supplied_key = request.headers.get("X-ProfConnect-Key", "")
    return supplied_key == expected_key


def current_professor():
    return db.session.get(Professor, session['professor_id'])

def login_required(view):
    @wraps(view)
    def wrapped(*args, **kwargs):
        if 'professor_id' not in session:
            return redirect(url_for('login'))
        return view(*args, **kwargs)
    return wrapped

def available_slots(professor, day):
    hours = OfficeHour.query.filter_by(professor_id=professor.id, weekday=day.weekday(), enabled=True).all()
    result = []
    for hours_row in hours:
        cursor = datetime.combine(day, hours_row.start_time)
        end = datetime.combine(day, hours_row.end_time)
        while cursor + timedelta(minutes=professor.slot_minutes) <= end:
            slot_end = cursor + timedelta(minutes=professor.slot_minutes)
            busy = Appointment.query.filter(
                Appointment.professor_id == professor.id,
                Appointment.status.in_(['CONFIRMED', 'PENDING']),
                Appointment.starts_at < slot_end,
                Appointment.ends_at > cursor
            ).first()
            if not busy and cursor > datetime.now():
                result.append(cursor)
            cursor = slot_end
    return result

@app.route('/')
def home():
    professor = Professor.query.first()
    return redirect(url_for('kiosk', slug=professor.slug)) if professor else 'Run: flask --app app seed', 500

@app.route('/kiosk/<slug>')
def kiosk(slug):
    return render_template('kiosk.html', professor=professor_or_404(slug))

@app.route('/api/public/professors/<slug>/display')
def display_api(slug):
    p = professor_or_404(slug)
    next_slot = None
    for offset in range(8):
        slots = available_slots(p, date.today() + timedelta(days=offset))
        if slots:
            next_slot = slots[0].isoformat()
            break
    return jsonify({'name': p.name, 'department': p.department, 'designation': p.designation,
        'office': p.office, 'status': p.status, 'message': p.status_message,
        'updated_at': p.updated_at.isoformat(), 'booking_url': url_for('book', slug=p.slug, _external=True),
        'next_available': next_slot})

@app.route('/api/professors/<slug>/presence', methods=['POST'])
def update_presence_api(slug):
    if not presence_api_authorized():
        return jsonify({
            "ok": False,
            "error": "Unauthorized"
        }), 401

    professor = professor_or_404(slug)

    payload = request.get_json(silent=True) or {}
    status = str(payload.get("status", "")).upper().strip()
    message = str(payload.get("message", "")).strip()[:180]

    allowed_statuses = {
        "IN_OFFICE",
        "OUT_OF_OFFICE",
        "BUSY",
        "AWAY",
        "UNAVAILABLE"
    }

    if status not in allowed_statuses:
        return jsonify({
            "ok": False,
            "error": "Invalid status",
            "allowed_statuses": sorted(allowed_statuses)
        }), 400

    professor.status = status
    professor.status_message = message
    professor.updated_at = datetime.utcnow()

    db.session.commit()

    return jsonify({
        "ok": True,
        "professor": {
            "slug": professor.slug,
            "name": professor.name,
            "status": professor.status,
            "message": professor.status_message,
            "updated_at": professor.updated_at.isoformat()
        }
    })

@app.route('/p/<slug>/qr.png')
def qr_code(slug):
    p = professor_or_404(slug)
    qr = qrcode.make(url_for('book', slug=p.slug, _external=True))
    output = BytesIO(); qr.save(output, 'PNG'); output.seek(0)
    return send_file(output, mimetype='image/png', max_age=300)

@app.route('/p/<slug>/book', methods=['GET', 'POST'])
def book(slug):
    p = professor_or_404(slug)
    selected_day = request.values.get('date', date.today().isoformat())
    try: day = date.fromisoformat(selected_day)
    except ValueError: day = date.today()
    slots = available_slots(p, day)
    if request.method == 'POST':
        required = ['student_name', 'student_email', 'student_id', 'purpose', 'starts_at']
        if any(not request.form.get(x, '').strip() for x in required):
            flash('Please fill every field and choose a time slot.', 'error')
        else:
            try: start = datetime.fromisoformat(request.form['starts_at'])
            except ValueError: abort(400)
            if start not in available_slots(p, start.date()):
                flash('That slot is no longer available. Please choose another.', 'error')
            else:
                appt = Appointment(professor_id=p.id, student_name=request.form['student_name'].strip(),
                    student_email=request.form['student_email'].strip(), student_id=request.form['student_id'].strip(),
                    purpose=request.form['purpose'].strip(), starts_at=start,
                    ends_at=start + timedelta(minutes=p.slot_minutes))
                db.session.add(appt); db.session.commit()
                return render_template('confirmed.html', professor=p, appointment=appt)
    return render_template('book.html', professor=p, selected_day=day, slots=slots)

@app.route('/login', methods=['GET', 'POST'])
def login():
    if request.method == 'POST':
        if request.form.get('email') == os.getenv('ADMIN_EMAIL', 'professor@college.edu') and request.form.get('password') == os.getenv('ADMIN_PASSWORD', 'ChangeMe123!'):
            p = Professor.query.first(); session['professor_id'] = p.id
            return redirect(url_for('dashboard'))
        flash('Invalid email or password.', 'error')
    return render_template('login.html')

@app.route('/logout')
def logout():
    session.clear(); return redirect(url_for('login'))

@app.route('/dashboard')
@login_required
def dashboard():
    p = current_professor()
    appointments = Appointment.query.filter_by(professor_id=p.id).order_by(Appointment.starts_at).all()
    return render_template('dashboard.html', professor=p, appointments=appointments,
        hours=OfficeHour.query.filter_by(professor_id=p.id).order_by(OfficeHour.weekday).all())

@app.route('/dashboard/presence', methods=['POST'])
@login_required
def update_presence():
    p = current_professor(); p.status = request.form.get('status', 'AWAY')
    p.status_message = request.form.get('message', '').strip()[:180]; p.updated_at = datetime.utcnow()
    db.session.commit(); flash('Presence is now live on the kiosk.', 'success')
    return redirect(url_for('dashboard'))

@app.route('/dashboard/hours', methods=['POST'])
@login_required
def add_hours():
    p = current_professor()
    try:
        row = OfficeHour(professor_id=p.id, weekday=int(request.form['weekday']),
            start_time=time.fromisoformat(request.form['start_time']), end_time=time.fromisoformat(request.form['end_time']))
        if row.start_time >= row.end_time: raise ValueError
        db.session.add(row); db.session.commit(); flash('Office hours added.', 'success')
    except (ValueError, KeyError): flash('Enter valid start and end times.', 'error')
    return redirect(url_for('dashboard'))

@app.route('/dashboard/appointments/<int:appointment_id>/status', methods=['POST'])
@login_required
def appointment_status(appointment_id):
    appt = db.get_or_404(Appointment, appointment_id)
    if appt.professor_id != current_professor().id: abort(403)
    appt.status = request.form.get('status', 'CANCELLED'); db.session.commit()
    return redirect(url_for('dashboard'))

@app.cli.command('seed')
def seed():
    db.create_all()
    if not Professor.query.first():
        p = Professor(slug='dr-ananya-sharma', name='Dr. Ananya Sharma', department='Computer Science and Engineering', designation='Associate Professor', office='Block B, Room 204', status='IN_OFFICE', status_message='Available for walk-ins')
        db.session.add(p); db.session.flush()
        for weekday in range(5): db.session.add(OfficeHour(professor_id=p.id, weekday=weekday, start_time=time(10, 0), end_time=time(16, 0)))
        db.session.commit()
    print('Database seeded. Open http://localhost:5000/kiosk/dr-ananya-sharma')

if __name__ == '__main__':
    with app.app_context(): db.create_all()
    app.run(host='0.0.0.0', port=5000, debug=True)
