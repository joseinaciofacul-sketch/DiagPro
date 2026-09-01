from django.db import models
from django.conf import settings
from django.core.validators import MaxValueValidator, MinValueValidator
from django.utils import timezone
import uuid


class Empresa(models.Model):
    usuario = models.OneToOneField(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name='empresa',
        null=True,
        blank=True,
    )
    nome = models.CharField(max_length=150)
    cnpj = models.CharField(max_length=18, unique=True, null=True, blank=True)
    email = models.EmailField(blank=True)
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


class Plano(models.Model):
    nome = models.CharField(max_length=120)
    slug = models.SlugField(max_length=120, unique=True)
    descricao = models.TextField(blank=True)
    ativo = models.BooleanField(default=True, db_index=True)
    preco_mensal = models.DecimalField(
        max_digits=10,
        decimal_places=2,
        null=True,
        blank=True,
        validators=[MinValueValidator(0)],
    )
    moeda = models.CharField(max_length=3, blank=True)
    max_usuarios = models.PositiveIntegerField(null=True, blank=True, validators=[MinValueValidator(1)])
    max_dispositivos = models.PositiveIntegerField(null=True, blank=True, validators=[MinValueValidator(1)])
    max_diagnosticos_mes = models.PositiveIntegerField(null=True, blank=True, validators=[MinValueValidator(1)])
    scanner_completo = models.BooleanField(default=False)
    remediacao = models.BooleanField(default=False)
    relatorios = models.BooleanField(default=False)
    visao_gerencial = models.BooleanField(default=False)

    class Meta:
        ordering = ['nome', 'id']

    def __str__(self):
        return self.nome


class Licenca(models.Model):
    PLANO_CHOICES = [
        ('mensal', 'Mensal'),
        ('anual', 'Anual'),
        ('empresarial', 'Empresarial'),
    ]

    STATUS_CHOICES = [
        ('trial', 'Período de teste'),
        ('active', 'Ativa'),
        ('past_due', 'Pagamento pendente'),
        ('canceled', 'Cancelada'),
        ('expired', 'Expirada'),
    ]

    usuario = models.OneToOneField(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name='licenca',
        null=True,
    )
    empresa = models.OneToOneField(
        Empresa,
        on_delete=models.SET_NULL,
        related_name='licenca',
        null=True,
        blank=True,
    )
    plano = models.ForeignKey(
        Plano,
        on_delete=models.PROTECT,
        related_name='licencas',
        null=True,
    )
    serial = models.UUIDField(default=uuid.uuid4, editable=False, unique=True)
    ciclo_legado = models.CharField(max_length=20, choices=PLANO_CHOICES, default='mensal')
    inicio = models.DateTimeField(auto_now_add=True)
    fim = models.DateTimeField()
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, null=True)
    renovacao_automatica = models.BooleanField(default=False)
    provider = models.CharField(max_length=60, blank=True)
    external_subscription_id = models.CharField(max_length=180, blank=True)
    ativa_legado = models.BooleanField(default=True)
    atualizado_em = models.DateTimeField(auto_now=True, null=True)

    @property
    def status_efetivo(self):
        if self.fim and self.fim < timezone.now():
            return 'expired'
        return self.status

    @property
    def valida(self):
        return self.status_efetivo in {'trial', 'active'}

    def __str__(self):
        plano = self.plano.nome if self.plano_id else 'sem plano configurado'
        return f'Assinatura {plano} - usuário {self.usuario_id or "legado"}'


class Pagamento(models.Model):
    STATUS_CHOICES = [
        ('checkout_created', 'Checkout criado'),
        ('pending', 'Pagamento pendente'),
        ('approved', 'Pagamento aprovado'),
        ('rejected', 'Pagamento recusado'),
        ('canceled', 'Pagamento cancelado'),
        ('refunded', 'Pagamento reembolsado'),
        ('charged_back', 'Pagamento contestado'),
        ('invalid', 'Pagamento inválido'),
        ('failed', 'Falha de integração'),
    ]

    usuario = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name='pagamentos',
    )
    plano = models.ForeignKey(
        Plano,
        on_delete=models.PROTECT,
        related_name='pagamentos',
    )
    provider = models.CharField(max_length=30, default='mercadopago', editable=False)
    external_reference = models.UUIDField(default=uuid.uuid4, unique=True, editable=False)
    external_preference_id = models.CharField(max_length=180, blank=True, db_index=True)
    external_payment_id = models.CharField(max_length=180, null=True, blank=True, unique=True)
    status = models.CharField(max_length=30, choices=STATUS_CHOICES, default='checkout_created', db_index=True)
    provider_status = models.CharField(max_length=60, blank=True)
    provider_status_detail = models.CharField(max_length=180, blank=True)
    valor_esperado = models.DecimalField(
        max_digits=10,
        decimal_places=2,
        validators=[MinValueValidator(0.01)],
    )
    moeda = models.CharField(max_length=3)
    checkout_url = models.URLField(max_length=600, blank=True)
    sandbox = models.BooleanField(default=True)
    webhook_count = models.PositiveIntegerField(default=0)
    ultimo_webhook_request_id = models.CharField(max_length=180, blank=True)
    erro_codigo = models.CharField(max_length=80, blank=True)
    pago_em = models.DateTimeField(null=True, blank=True)
    ativado_em = models.DateTimeField(null=True, blank=True)
    criado_em = models.DateTimeField(auto_now_add=True)
    atualizado_em = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['-criado_em', '-id']
        indexes = [
            models.Index(fields=['usuario', '-criado_em'], name='payment_user_created_idx'),
        ]

    def __str__(self):
        return f'Pagamento #{self.pk} - {self.status}'


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
    scan_id = models.UUIDField(null=True, blank=True)

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

    security_risk_score = models.PositiveSmallIntegerField(
        null=True,
        blank=True,
        validators=[MinValueValidator(0), MaxValueValidator(100)],
    )
    security_risk_level = models.CharField(max_length=20, null=True, blank=True)
    security_risk_status = models.CharField(max_length=30, null=True, blank=True)
    security_risk_version = models.CharField(max_length=20, null=True, blank=True)
    security_schema_version = models.CharField(max_length=20, null=True, blank=True)

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
            models.Index(
                fields=['usuario', 'security_risk_level', '-finalizado_em'],
                name='diag_user_risk_idx',
            ),
        ]
        constraints = [
            models.UniqueConstraint(
                fields=['usuario', 'scan_id'],
                condition=models.Q(scan_id__isnull=False),
                name='diag_user_scan_unique',
            ),
        ]

    def __str__(self):
        return f'Diagnóstico #{self.pk} - {self.serial}'


class SecurityFinding(models.Model):
    SEVERITY_CHOICES = [
        ('info', 'Informativo'),
        ('low', 'Baixo'),
        ('medium', 'Médio'),
        ('high', 'Alto'),
        ('critical', 'Crítico'),
    ]
    EVIDENCE_CONFIDENCE_CHOICES = [
        ('low', 'Baixa'),
        ('medium', 'Média'),
        ('high', 'Alta'),
    ]
    SUBJECT_TYPE_CHOICES = [
        ('device', 'Dispositivo'),
        ('app', 'Aplicativo'),
    ]
    STATUS_CHOICES = [
        ('open', 'Aberto'),
        ('reviewed', 'Revisado'),
        ('remediation_pending', 'Remediação pendente'),
        ('resolved', 'Resolvido'),
        ('verification_failed', 'Verificação falhou'),
        ('dismissed', 'Descartado'),
    ]

    diagnostico = models.ForeignKey(
        Diagnostico,
        on_delete=models.CASCADE,
        related_name='security_findings',
    )
    finding_id = models.CharField(max_length=400)
    rule_id = models.CharField(max_length=200)
    category = models.CharField(max_length=100)
    subject_type = models.CharField(max_length=20, choices=SUBJECT_TYPE_CHOICES)
    subject_id = models.CharField(max_length=255)
    title = models.CharField(max_length=240)
    summary = models.TextField(blank=True)
    severity = models.CharField(max_length=20, choices=SEVERITY_CHOICES)
    evidence_confidence = models.CharField(max_length=20, choices=EVIDENCE_CONFIDENCE_CHOICES)
    status = models.CharField(max_length=30, choices=STATUS_CHOICES, default='open')
    recommendation = models.TextField(blank=True)
    remediation_type = models.CharField(max_length=50, blank=True)
    remediation_available = models.BooleanField(default=False)
    evidence = models.JSONField(default=list)
    score_contribution = models.DecimalField(
        max_digits=5,
        decimal_places=2,
        null=True,
        blank=True,
        validators=[MinValueValidator(0), MaxValueValidator(100)],
    )
    scorer_version = models.CharField(max_length=20, null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['-diagnostico__finalizado_em', '-id']
        indexes = [
            models.Index(fields=['rule_id'], name='secfind_rule_idx'),
            models.Index(fields=['severity', 'category', 'status'], name='secfind_filter_idx'),
        ]
        constraints = [
            models.UniqueConstraint(
                fields=['diagnostico', 'rule_id', 'subject_type', 'subject_id'],
                name='uniq_diag_security_finding',
            ),
        ]

    def __str__(self):
        return f'{self.rule_id} - diagnóstico #{self.diagnostico_id}'
