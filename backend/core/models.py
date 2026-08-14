from django.db import models
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
    empresa = models.ForeignKey(Empresa, on_delete=models.CASCADE, related_name='clientes')
    nome = models.CharField(max_length=150)
    telefone = models.CharField(max_length=20, blank=True)
    email = models.EmailField(blank=True)
    data_cadastro = models.DateTimeField(auto_now_add=True)

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
# Create your models here.
