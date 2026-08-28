from django.db import models
from django.conf import settings
from django.core.validators import MaxValueValidator, MinValueValidator
import uuid


class Empresa(models.Model):
    nome = models.CharField(max_length=150)
    cnpj = models.CharField(max_length=18, unique=True)
    email = models.EmailField()
    telefone = models.CharField(max_length=20, blank=True)
    endereco = models.CharField(max_length=255, blank=True)
    logo = models.ImageField(upload_to='logos/', blank=True, null=True)
    data_cadastro = models.DateTimeField(auto_now_add=True)
    ativo = models.BooleanField(default=True)

    def __str__(self):
        return self.nome


class Cliente(models.Model):
    usuario = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name='clientes',
    )
    empresa = models.ForeignKey(
        Empresa,
        on_delete=models.SET_NULL,
        related_name='clientes',
        null=True,
        blank=True,
    )
    nome = models.CharField(max_length=150)
    telefone = models.CharField(max_length=20, blank=True)
    email = models.EmailField(blank=True)
    documento = models.CharField(max_length=50, blank=True)
    observacoes = models.TextField(blank=True)
    criado_em = models.DateTimeField(auto_now_add=True)
    atualizado_em = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['nome', 'id']
        indexes = [models.Index(fields=['usuario', 'nome'], name='client_user_name_idx')]

    def __str__(self):
        return self.nome
class Dispositivo(models.Model):
    TIPO_CHOICES = [
        ('android', 'Android'),
        ('ios', 'iPhone'),
        ('pc', 'Computador'),
    ]

    cliente = models.ForeignKey(Cliente, on_delete=models.CASCADE, related_name='dispositivos')
    tipo = models.CharField(max_length=10, choices=TIPO_CHOICES)
    fabricante = models.CharField(max_length=100, blank=True)
    modelo = models.CharField(max_length=100, blank=True)
    numero_serie = models.CharField(max_length=100, blank=True)
    sistema_operacional = models.CharField(max_length=100, blank=True)
    data_cadastro = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        return f'{self.modelo or "Dispositivo"} ({self.get_tipo_display()})'


class Analise(models.Model):
    dispositivo = models.ForeignKey(Dispositivo, on_delete=models.CASCADE, related_name='analises')
    tecnico = models.ForeignKey('auth.User', on_delete=models.SET_NULL, null=True, related_name='analises')

    score_geral = models.PositiveSmallIntegerField(default=0)
    score_seguranca = models.PositiveSmallIntegerField(default=0)
    score_bateria = models.PositiveSmallIntegerField(default=0)
    score_armazenamento = models.PositiveSmallIntegerField(default=0)
    score_performance = models.PositiveSmallIntegerField(default=0)
    score_sistema = models.PositiveSmallIntegerField(default=0)

    dados_brutos = models.JSONField(default=dict, blank=True)
    resumo_ia = models.TextField(blank=True)

    data_analise = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        return f'Análise #{self.pk} - {self.dispositivo}'


class Relatorio(models.Model):
    analise = models.OneToOneField(Analise, on_delete=models.CASCADE, related_name='relatorio')
    qr_code_token = models.UUIDField(default=uuid.uuid4, editable=False, unique=True)
    arquivo_pdf = models.FileField(upload_to='relatorios/', blank=True, null=True)
    data_geracao = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        return f'Relatório #{self.pk}'


class Licenca(models.Model):
    PLANO_CHOICES = [
        ('mensal', 'Mensal'),
        ('anual', 'Anual'),
        ('empresarial', 'Empresarial'),
    ]

    empresa = models.OneToOneField(Empresa, on_delete=models.CASCADE, related_name='licenca')
    serial = models.UUIDField(default=uuid.uuid4, editable=False, unique=True)
    plano = models.CharField(max_length=20, choices=PLANO_CHOICES, default='mensal')
    data_inicio = models.DateTimeField(auto_now_add=True)
    data_expiracao = models.DateTimeField()
    ativa = models.BooleanField(default=True)

    def __str__(self):
        return f'Licença {self.plano} - {self.empresa}'


class Diagnostico(models.Model):
    MODO_CHOICES = [
        ('quick', 'Rápida'),
        ('complete', 'Completa'),
        ('custom', 'Personalizada'),
    ]

    usuario = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name='diagnosticos',
    )
    cliente = models.ForeignKey(
        Cliente,
        on_delete=models.SET_NULL,
        related_name='diagnosticos',
        null=True,
        blank=True,
    )
    serial = models.CharField(max_length=128, db_index=True)
    fabricante = models.CharField(max_length=120, blank=True)
    modelo = models.CharField(max_length=120, blank=True)
    versao_android = models.CharField(max_length=50, blank=True)
    sdk = models.PositiveSmallIntegerField(null=True, blank=True)
    security_patch = models.DateField(null=True, blank=True)

    modo = models.CharField(max_length=20, choices=MODO_CHOICES)
    modulos = models.JSONField(default=list)
    iniciado_em = models.DateTimeField()
    finalizado_em = models.DateTimeField(db_index=True)

    health_available = models.BooleanField(null=True, blank=True)
    health_score = models.PositiveSmallIntegerField(
        null=True,
        blank=True,
        validators=[MinValueValidator(0), MaxValueValidator(100)],
    )
    health_label = models.CharField(max_length=80, blank=True)
    health_explanation = models.TextField(blank=True)

    bateria = models.JSONField(null=True, blank=True)
    armazenamento = models.JSONField(null=True, blank=True)
    memoria = models.JSONField(null=True, blank=True)
    apps = models.JSONField(null=True, blank=True)
    warnings = models.JSONField(default=list, blank=True)
    stages = models.JSONField(default=dict, blank=True)
    resultado_tecnico = models.JSONField(default=dict)
    criado_em = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-finalizado_em', '-id']
        indexes = [
            models.Index(fields=['usuario', '-finalizado_em'], name='diag_user_finished_idx'),
            models.Index(fields=['usuario', 'serial', '-finalizado_em'], name='diag_user_serial_idx'),
        ]

    def __str__(self):
        return f'Diagnóstico #{self.pk} - {self.serial}'
