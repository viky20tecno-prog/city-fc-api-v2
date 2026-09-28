"""Genera los assets visuales del club demo Zensports FC (escudo, prendas del catálogo,
comprobantes de pago genéricos y PDFs de documentos) en ./out/.

Uso:  python3 scripts/assets_zensports_fc/generar_assets.py
Luego seed_zensports_fc.js los sube a Storage. Todo es inventado: los comprobantes NO
imitan la marca de ningún banco a propósito.
"""
import os
import random
from PIL import Image, ImageDraw, ImageFont

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'out')
os.makedirs(OUT, exist_ok=True)

NAVY = (11, 31, 58)
TEAL = (0, 184, 169)
LIME = (190, 242, 100)
WHITE = (255, 255, 255)
GRAY = (120, 130, 145)

F = '/usr/share/fonts/truetype/dejavu/'
def font(size, bold=True):
    return ImageFont.truetype(F + ('DejaVuSans-Bold.ttf' if bold else 'DejaVuSans.ttf'), size)

def centrado(d, xy_centro, texto, fnt, fill):
    x0, y0, x1, y1 = d.textbbox((0, 0), texto, font=fnt)
    d.text((xy_centro[0] - (x1 - x0) / 2, xy_centro[1] - (y1 - y0) / 2 - y0), texto, font=fnt, fill=fill)


def escudo():
    s = 1024
    img = Image.new('RGBA', (s, s), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    forma = [(512, 60), (900, 170), (880, 560), (512, 960), (144, 560), (124, 170)]
    d.polygon(forma, fill=NAVY)
    interior = [(512, 110), (850, 205), (832, 545), (512, 900), (192, 545), (174, 205)]
    d.polygon(interior, fill=TEAL)
    d.polygon([(512, 150), (810, 235), (795, 530), (512, 850), (229, 530), (214, 235)], fill=NAVY)
    # franja diagonal
    d.polygon([(214, 470), (810, 300), (805, 390), (226, 560)], fill=TEAL)
    centrado(d, (512, 370), 'ZS', font(220), WHITE)
    centrado(d, (512, 650), 'FC', font(150), LIME)
    for i, x in enumerate((452, 512, 572)):
        d.regular_polygon((x, 215, 18), 5, rotation=-18, fill=LIME)
    img.save(os.path.join(OUT, 'escudo.png'))


def lienzo_prenda(titulo):
    img = Image.new('RGB', (800, 800), (238, 243, 248))
    d = ImageDraw.Draw(img)
    d.rounded_rectangle((40, 40, 760, 760), 48, fill=(226, 233, 241))
    return img, d

def camiseta(nombre, cuerpo, detalle, numero=None):
    img, d = lienzo_prenda(nombre)
    d.polygon([(250, 170), (330, 140), (470, 140), (550, 170), (680, 280), (610, 360), (560, 320),
               (560, 660), (240, 660), (240, 320), (190, 360), (120, 280)], fill=cuerpo)
    d.polygon([(330, 140), (400, 200), (470, 140), (450, 140), (400, 175), (350, 140)], fill=detalle)
    d.rectangle((240, 330, 560, 370), fill=detalle)
    d.ellipse((440, 230, 500, 290), fill=WHITE)
    centrado(d, (470, 260), 'ZS', font(22), NAVY)
    if numero:
        centrado(d, (400, 500), numero, font(130), detalle)
    img.save(os.path.join(OUT, f'{nombre}.png'))

def pantaloneta():
    img, d = lienzo_prenda('pantaloneta')
    d.polygon([(230, 220), (570, 220), (620, 600), (430, 600), (400, 380), (370, 600), (180, 600)], fill=NAVY)
    d.rectangle((230, 220, 570, 260), fill=TEAL)
    d.line([(200, 590), (240, 260)], fill=TEAL, width=14)
    d.line([(600, 590), (560, 260)], fill=TEAL, width=14)
    img.save(os.path.join(OUT, 'pantaloneta.png'))

def medias():
    img, d = lienzo_prenda('medias')
    for dx in (0, 190):
        d.polygon([(250 + dx, 150), (360 + dx, 150), (360 + dx, 520), (420 + dx, 600), (400 + dx, 660),
                   (260 + dx, 660), (250 + dx, 560)], fill=WHITE)
        d.rectangle((250 + dx, 150, 360 + dx, 200), fill=TEAL)
        d.rectangle((250 + dx, 225, 360 + dx, 245), fill=NAVY)
    img.save(os.path.join(OUT, 'medias.png'))

def chaqueta():
    img, d = lienzo_prenda('chaqueta')
    d.polygon([(250, 160), (550, 160), (690, 300), (640, 680), (560, 680), (560, 330), (560, 680),
               (240, 680), (240, 330), (240, 680), (160, 680), (110, 300)], fill=NAVY)
    d.line([(400, 170), (400, 680)], fill=(200, 205, 215), width=6)
    d.polygon([(330, 160), (400, 230), (470, 160)], fill=TEAL)
    d.line([(160, 670), (120, 310)], fill=TEAL, width=16)
    d.line([(640, 670), (680, 310)], fill=TEAL, width=16)
    d.ellipse((450, 250, 510, 310), fill=WHITE)
    centrado(d, (480, 280), 'ZS', font(22), NAVY)
    img.save(os.path.join(OUT, 'chaqueta.png'))

def maleta():
    img, d = lienzo_prenda('maleta')
    d.rounded_rectangle((230, 200, 570, 660), 60, fill=NAVY)
    d.rounded_rectangle((280, 420, 520, 620), 30, fill=TEAL)
    d.arc((320, 120, 480, 280), 180, 360, fill=NAVY, width=24)
    centrado(d, (400, 320), 'ZENSPORTS', font(34), WHITE)
    img.save(os.path.join(OUT, 'maleta.png'))


def comprobante(i, monto, referencia, fecha, nombre):
    img = Image.new('RGB', (720, 1280), WHITE)
    d = ImageDraw.Draw(img)
    d.rectangle((0, 0, 720, 180), fill=(46, 58, 89))
    centrado(d, (360, 90), 'Comprobante de transferencia', font(34), WHITE)
    d.ellipse((300, 240, 420, 360), fill=(34, 197, 94))
    d.line([(330, 300), (355, 328), (395, 272)], fill=WHITE, width=12)
    centrado(d, (360, 420), 'Transferencia exitosa', font(36), (30, 30, 30))
    centrado(d, (360, 510), f'$ {monto:,.0f}'.replace(',', '.'), font(64), (30, 30, 30))
    filas = [('Para', 'Zensports FC'), ('Concepto', 'Mensualidad'), ('Enviado por', nombre),
             ('Fecha', fecha), ('Referencia', referencia), ('Cuenta destino', '*** *** 4821')]
    y = 640
    for k, v in filas:
        d.text((70, y), k, font=font(26, False), fill=GRAY)
        x0, _, x1, _ = d.textbbox((0, 0), v, font=font(26))
        d.text((650 - (x1 - x0), y), v, font=font(26), fill=(30, 30, 30))
        d.line([(70, y + 50), (650, y + 50)], fill=(230, 230, 230), width=2)
        y += 80
    centrado(d, (360, 1200), 'Documento de demostración — no es un comprobante real', font(20, False), GRAY)
    img.save(os.path.join(OUT, f'comprobante_{i}.png'))


def pdf(nombre, titulo, parrafos):
    paginas = []
    img = Image.new('RGB', (1240, 1754), WHITE)
    d = ImageDraw.Draw(img)
    esc = Image.open(os.path.join(OUT, 'escudo.png')).resize((160, 160))
    img.paste(esc, (100, 90), esc)
    d.text((290, 120), 'Zensports FC', font=font(44), fill=NAVY)
    d.text((290, 185), 'Club deportivo formativo · Medellín', font=font(26, False), fill=GRAY)
    d.line([(100, 290), (1140, 290)], fill=TEAL, width=6)
    d.text((100, 330), titulo, font=font(40), fill=NAVY)
    y = 430
    f = font(26, False)
    for p in parrafos:
        linea = ''
        for palabra in p.split():
            prueba = (linea + ' ' + palabra).strip()
            if d.textlength(prueba, font=f) > 1040:
                d.text((100, y), linea, font=f, fill=(40, 40, 40)); y += 42; linea = palabra
            else:
                linea = prueba
        d.text((100, y), linea, font=f, fill=(40, 40, 40)); y += 70
    d.text((100, 1650), 'Documento de demostración generado para ZenSports.', font=font(20, False), fill=GRAY)
    paginas.append(img)
    paginas[0].save(os.path.join(OUT, f'{nombre}.pdf'), 'PDF', resolution=150)


if __name__ == '__main__':
    escudo()
    camiseta('camiseta_titular', TEAL, NAVY, '10')
    camiseta('camiseta_alterna', WHITE, TEAL, '7')
    camiseta('camiseta_arquero', (250, 204, 21), NAVY, '1')
    pantaloneta(); medias(); chaqueta(); maleta()

    random.seed(7)
    nombres = ['Luz Marina Ospina', 'Jorge Iván Restrepo', 'Paola Andrea Zapata', 'Carlos Mario Gil',
               'Diana Patricia Henao', 'Juan Camilo Arango', 'Sandra Milena Úsuga', 'Ana María Cardona',
               'Luis Fernando Rendón', 'Gloria Estela Mesa']
    for i in range(10):
        monto = [80000, 80000, 160000, 40000, 80000, 240000, 80000, 60000, 80000, 80000][i]
        comprobante(i + 1, monto, f'M{random.randint(10**7, 10**8 - 1)}',
                    f'{20 + i % 8} sep 2026 · {8 + i}:{10 + i * 3:02d}', nombres[i])

    pdf('reglamento_interno', 'Reglamento interno del club', [
        '1. Puntualidad. Los atletas deben llegar 15 minutos antes de cada entrenamiento con el uniforme de práctica completo.',
        '2. Respeto. Se espera trato respetuoso hacia compañeros, entrenadores, árbitros y rivales. Las faltas graves se reportan al acudiente.',
        '3. Mensualidad. La cuota se paga dentro de los primeros 7 días de cada mes. Después de ese plazo el sistema la marca en mora.',
        '4. Asistencia. Tres ausencias injustificadas en el mes pueden afectar la convocatoria a partidos y torneos.',
        '5. Uniformes. El uniforme oficial se usa en partidos y eventos. Los pedidos se hacen por rondas desde el Portal del Atleta.',
    ])
    pdf('autorizacion_acudientes', 'Autorización de acudientes', [
        'Yo, en calidad de padre, madre o acudiente, autorizo la participación del menor en los entrenamientos, partidos, torneos y desplazamientos organizados por Zensports FC.',
        'Declaro que el menor se encuentra afiliado a una EPS y apto para la práctica deportiva según valoración médica vigente.',
        'Me comprometo a mantener actualizados los datos de contacto y a informar cualquier condición médica relevante.',
        'Firma del acudiente: ______________________   Documento: ______________   Fecha: ___________',
    ])
    pdf('tratamiento_datos', 'Política de tratamiento de datos personales', [
        'Zensports FC recolecta los datos personales de atletas y acudientes únicamente para la gestión deportiva, administrativa y de comunicación del club, conforme a la Ley 1581 de 2012.',
        'Los datos se almacenan en una plataforma segura y no se comparten con terceros sin autorización expresa.',
        'El titular puede conocer, actualizar, rectificar o solicitar la supresión de sus datos escribiendo al correo del club.',
    ])
    pdf('calendario_temporada', 'Calendario de la temporada 2026', [
        'Enero: inicio de entrenamientos y evaluación de categorías.',
        'Marzo: Copa Valle de Aburrá Infantil (fútbol).',
        'Junio: Festival Intercolegiado de Voleibol.',
        'Agosto: Liga Metropolitana de Baloncesto Formativo.',
        'Diciembre: Torneo Navideño Zensports y clausura de la temporada con entrega de reconocimientos.',
    ])
    # QR de pago: con el paquete npm `qrcode` del dashboard (no hay librería de QR en Python acá)
    dash = os.path.normpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', '..', '..', 'dashboard'))
    os.system(f"cd '{dash}' && node -e \"require('qrcode').toFile('{os.path.join(OUT, 'qr_pago.png')}','Zensports FC - Llave de pago @zensportsfc - DEMO',{{width:512,margin:2,color:{{dark:'#0B1F3A',light:'#FFFFFF'}}}},e=>e&&console.error(e))\"")
    print('Assets generados en', OUT)
